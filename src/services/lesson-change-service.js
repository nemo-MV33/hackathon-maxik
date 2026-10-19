import { withDeadline, dueReminderAt } from '../lib/homework-details.js';
import { groupKey, sameGroup } from '../universities/identity.js';
import { zonedMoment, lessonMoments, universityTimeZone } from '../lib/timezone.js';
import { randomUUID } from 'node:crypto';
import { parseDateKey } from '../lib/date.js';
import { HttpError } from '../http/routes/me.js';
import { texts } from '../bot/i18n.js';

export const lessonSlot = (lesson) => `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;
const sameSlot = (left, right) => left && right && lessonSlot(left) === lessonSlot(right);
const start = (lesson) => zonedMoment(lesson.date, lesson.time.slice(0, 5), lesson.timeZone).getTime();
const compact = (lesson) => ({ ...lesson, subgroup: lesson.subgroup ?? null });

export class LessonChangeService {
  #queue = Promise.resolve();

  constructor({ community, preferences, service, bot, now = () => new Date() }) {
    Object.assign(this, { community, preferences, service, bot, now });
  }

  #serial(action) {
    const pending = this.#queue.then(action);
    this.#queue = pending.catch(() => {});
    return pending;
  }

  async authorize(groupId, userId) {
    if (await this.community.homeworkRoleForGroup(groupId, userId) === 'student') {
      throw new HttpError(403, 'homework_forbidden', 'Нет прав на изменение общего ДЗ');
    }
  }

  async find(groupId, input) {
    if (!input || !parseDateKey(input.date) || !Number.isInteger(input.lessonNumber)
      || input.lessonNumber < 1 || ![null, 1, 2].includes(input.subgroup ?? null)) {
      throw new HttpError(400, 'invalid_lesson', 'Некорректная пара');
    }
    const schedule = await this.service.groupSchedule(groupId, { week: parseDateKey(input.date), raw: true });
    const found = schedule.lessons.find((lesson) => sameSlot(lesson, input));
    if (!found) throw new HttpError(404, 'lesson_not_found', 'Пара не найдена в расписании');
    return compact(found);
  }

  async target(groupId, source, input) {
    if (input?.custom === undefined) return this.find(groupId, input);
    if (input.custom !== true) throw new HttpError(400, 'invalid_target');
    if (typeof input.date !== 'string' || typeof input.time !== 'string' || !parseDateKey(input.date) || !/^([01]\d|2[0-3]):[0-5]\d–([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
      throw new HttpError(400, 'invalid_target');
    }
    const [begin, end] = input.time.split('–');
    if (end <= begin || (input.date === source.date && input.time === source.time)) throw new HttpError(400, 'invalid_target');
    const minute = Number(begin.slice(0, 2)) * 60 + Number(begin.slice(3));
    // Отдельный диапазон идентификаторов не занимает слот исходного расписания.
    return lessonMoments({ ...source, date: input.date, time: input.time, lessonNumber: 1000 + minute, custom: true }, universityTimeZone(groupId));
  }

  async apply(groupId, from, to, id, by = 'schedule', actor = {}) {
    const at = this.now().toISOString();
    await this.community.relocateHomework(groupId, from, to, { id, at, by, authorId: actor.authorId, authorName: actor.authorName });
    for (const [userId, profile] of await this.preferences.entries()) {
      if (!sameGroup(profile.selection?.id, groupId) || profile.selection?.kind !== 'group') continue;
      const reminders = { ...profile.homeworkReminders };
      const old = reminders[lessonSlot(from)];
      if (!old) continue;
      delete reminders[lessonSlot(from)];
      if (to) {
        const relative = old.mode === 'lesson' || old.relativeTo === 'lesson';
        const due = old.mode?.startsWith('due-') ? (await this.community.homeworkForUser(groupId, userId, { from: to.date, to: to.date })).find((item) => item.lessonNumber === to.lessonNumber && (item.subgroup ?? null) === (to.subgroup ?? null)) : null;
        const nextAt = old.mode?.startsWith('due-') ? dueReminderAt(due ? (await withDeadline(due, this.service)).dueAt : null, old.mode, profile) : relative ? new Date(start(to) - (old.minutesBefore ?? 0) * 60_000).toISOString() : old.at;
        if (old.mode?.startsWith('due-') || new Date(nextAt) > this.now()) reminders[lessonSlot(to)] = { ...old, at: nextAt, time: to.time.slice(0, 5), suspended: false };
      } else reminders[lessonSlot(from)] = { ...old, suspended: true };
      await this.preferences.set(userId, { ...profile, homeworkReminders: reminders });
    }
    return (await this.community.homeworkForGroup(groupId, { from: to?.date ?? from.date, to: to?.date ?? from.date }))
      .find((item) => item.lessonNumber === (to ?? from).lessonNumber && (item.subgroup ?? null) === ((to ?? from).subgroup ?? null))?.text;
  }

  manual({ groupId, user, from, to }) {
    return this.#serial(async () => {
      await this.authorize(groupId, user.id);
      const source = await this.find(groupId, from);
      const target = to === null ? null : await this.target(groupId, source, to);
      if (target && (sameSlot(source, target) || source.subgroup !== target.subgroup)) {
        throw new HttpError(400, 'invalid_target', 'Выбери другую пару той же подгруппы');
      }
      const records = await this.community.lessonChanges(groupId);
      const existing = records.find((item) => item.status === 'pending' && sameSlot(item.from, source));
      if (existing && ((!target && !existing.to) || (sameSlot(existing.to, target) && (!target.custom || existing.to.time === target.time)))) return existing;
      if (existing && !target?.custom) throw new HttpError(409, 'move_exists');
      if (records.some((item) => item.id !== existing?.id && item.status === 'pending' && (sameSlot(item.to, source) || (target && (sameSlot(item.to, target) || sameSlot(item.from, target)))))) {
        throw new HttpError(409, 'move_exists');
      }
      if (existing) {
        const changed = { ...existing, to: target, at: this.now().toISOString(), authorId: user.id,
          authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id) };
        const homework = await this.apply(groupId, existing.to ?? source, target, `${existing.id}:edit:${randomUUID()}`, 'headman', changed);
        await this.community.saveLessonChange(changed);
        await this.notifyChats(groupId, [{ type: 'moved', previous: existing.to ?? source, lesson: target, homework }], changed);
        return changed;
      }
      const item = { id: randomUUID(), groupId, from: source, to: target, status: 'pending', at: this.now().toISOString(),
        authorId: user.id, authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id) };
      const homework = await this.apply(groupId, source, target, item.id, 'headman', item);
      await this.community.saveLessonChange(item);
      await this.notifyChats(groupId, [{ type: target ? 'moved' : 'cancelled', previous: source, lesson: target ? { ...source, ...target, subject: source.subject } : source, homework }], item);
      return item;
    });
  }

  undo(groupId, user, id) {
    return this.#serial(async () => {
      await this.authorize(groupId, user.id);
      const item = (await this.community.lessonChanges(groupId)).find((value) => value.id === id);
      if (!item) throw new HttpError(404, 'move_not_found', 'Отметка не найдена');
      if (item.status !== 'pending') return item;
      await this.apply(groupId, item.to ?? item.from, item.from, `${id}:undo`, 'headman', { authorId: user.id, authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id) });
      await this.community.saveLessonChange({ ...item, status: 'revoked' });
      await this.notifyChats(groupId, [], { ...item, status: 'revoked' });
      return { ...item, status: 'revoked' };
    });
  }

  official(groupId, change, id) {
    return this.#serial(async () => {
      id = `${groupKey(groupId)}:${id}`;
      if (await this.community.scheduleOperationApplied(id)) return { silent: true };
      const finish = async (result) => { await this.community.recordScheduleOperation(id); return result; };
      if (change.type === 'added') return finish({});
      const source = change.previous ?? change.lesson;
      const target = ['moved', 'room', 'teacher'].includes(change.type) ? change.lesson : null;
      const records = await this.community.lessonChanges(groupId);
      const manual = records.find((item) => item.status === 'pending' && sameSlot(item.from, source));
      if (manual) {
        const confirmed = change.type === 'moved' ? (manual.to?.custom ? manual.to.date === target?.date && manual.to.time === target?.time : sameSlot(manual.to, target)) : change.type === 'cancelled' && !manual.to;
        if (confirmed) {
          if (manual.to?.custom && target) await this.apply(groupId, manual.to, target, `${id}:confirm`);
          await this.community.saveLessonChange({ ...manual, status: 'confirmed', confirmedAt: this.now().toISOString() });
          return finish({ silent: true });
        }
        const homework = await this.apply(groupId, manual.to ?? source, target, `${id}:conflict`);
        await this.community.saveLessonChange({ ...manual, status: 'conflict', official: target, resolvedAt: this.now().toISOString() });
        const profile = await this.preferences.get(manual.authorId);
        await this.bot?.api.sendMessageToUser(manual.authorId, texts(profile.lang).moveConflict(source.subject)).catch(console.error);
        return finish({ homework });
      }
      if (['room', 'teacher'].includes(change.type)) return finish({});
      return finish({ homework: await this.apply(groupId, source, target, id) });
    });
  }

  async overlay(groupId, lessons, from, to) {
    let result = [...lessons];
    for (const item of await this.community.lessonChanges(groupId)) {
      if (item.status !== 'pending') continue;
      result = result.filter((lesson) => !sameSlot(lesson, item.from));
      if (item.to && item.to.date >= from && item.to.date <= to) {
        if (!item.to.custom) result = result.filter((lesson) => !sameSlot(lesson, item.to));
        result.push({ ...item.from, date: item.to.date, time: item.to.time, lessonNumber: item.to.lessonNumber,
          ...lessonMoments({ date: item.to.date, time: item.to.time }, item.to.timeZone ?? item.from.timeZone ?? universityTimeZone(groupId)),
          transferred: true, markedBy: item.authorName, markedAt: item.at, moveId: item.id });
      }
    }
    return result.sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  }

  async notifyChats(groupId, changes, manual) {
    for (const chat of await this.community.chatsForGroup(groupId)) {
      const t = texts(chat.lang);
      const text = manual?.status === 'revoked' ? t.moveRevoked(manual.from.subject) : changes.map((change) => {
        const source = change.previous ?? change.lesson;
        const when = (lesson) => `${lesson.date}, ${lesson.time?.slice(0, 5)}`;
        const lesson = change.lesson;
        let line;
        if (change.type === 'moved') line = t.changeMoved(source.subject, when(source), when(lesson));
        else if (change.type === 'cancelled') line = t.changeCancelled(when(lesson), lesson.subject);
        else if (change.type === 'added') line = t.changeAdded(when(lesson), lesson.subject);
        else if (change.type === 'subject') line = t.changeSubject(when(lesson), source.subject, lesson.subject);
        else if (change.type === 'room') line = t.changeRoom(when(lesson), lesson.subject, (source.auditories ?? []).join(', '), (lesson.auditories ?? []).join(', '));
        else line = t.changeTeacher(when(lesson), lesson.subject, (lesson.teachers ?? []).join(', '));
        return line + (change.homework ? `\n${t.homework}: ${change.homework}` : '');
      }).join('\n');
      const mark = manual && manual.status !== 'revoked' ? `\n${t.moveMarked(manual.authorName, new Intl.DateTimeFormat(t.locale, { dateStyle: 'short', timeStyle: 'short', timeZone: universityTimeZone(groupId) }).format(new Date(manual.at)))}` : '';
      if (text) await this.bot?.api.sendMessageToChat(chat.chatId, `${text}${mark}`).catch(console.error);
    }
  }
}
