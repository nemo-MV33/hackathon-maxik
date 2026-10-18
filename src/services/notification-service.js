import { withDeadline, detailsText, dueReminderAt } from '../lib/homework-details.js';
import { isDemo, demoAllowed } from './demo-service.js';
import { attachmentSummary } from '../bot/homework-attachments.js';
import { userDayLessons } from './user-schedule.js';
import { sameGroup, groupKey } from '../universities/identity.js';
import { universityTimeZone, zonedClock, zonedDateKey, zonedMinutes, profileTimeZone, lessonInTimeZone, zonedMoment } from '../lib/timezone.js';
import { startOfWeek, toDateKey } from '../lib/date.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Keyboard } from '@maxhub/max-bot-api';
import { CONTROL_TYPES } from '../bot/create-bot.js';
import { formatDate } from '../bot/format.js';
import { lessonTypeLabel, texts } from '../bot/i18n.js';
import { dateFromKey } from '../lib/irkutsk.js';
import { isQuiet, notificationEnabled, summaryTime, timeToMinutes } from '../lib/settings.js';

// Сводка и напоминания о контрольных приходят во время, которое выбрал пользователь (по умолчанию 20:00).
const summaryDue = (prefs, now) => !isQuiet(prefs, now) && zonedMinutes(now, profileTimeZone(prefs)) >= timeToMinutes(summaryTime(prefs));
const EXAM_REMINDER_DAYS = [3, 1];
const CHANGES_WINDOW_DAYS = 14;
const MINUTE = 60_000;

const lessonKey = (lesson) => `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;
const appPayload = (lesson, groupId) => `lesson_${lesson.universityDate ?? lesson.date}_${lesson.lessonNumber}_${lesson.subgroup ?? 0}${groupId ? `_${groupKey(groupId)}` : ''}`;
const forSubgroup = (subgroup, lessonSubgroup) => !subgroup || !lessonSubgroup || lessonSubgroup === subgroup;
const shortDate = (lang, key) => formatDate(lang, key, { weekday: 'short', day: 'numeric', month: 'short' });
const sameList = (left = [], right = []) => left.join('|') === right.join('|');

const slim = (lesson) => ({
  timeZone: lesson.timeZone, startsAt: lesson.startsAt, endsAt: lesson.endsAt,
  date: lesson.date,
  lessonNumber: lesson.lessonNumber,
  subgroup: lesson.subgroup ?? null,
  subject: lesson.subject,
  lessonType: lesson.lessonType,
  time: lesson.time,
  teachers: lesson.teachers ?? [],
  auditories: lesson.auditories ?? [],
});

// Сравнивает два снимка расписания группы за общие дни и возвращает список изменений.
export const diffSchedules = (before, after, { from, to }) => {
  const inRange = (lesson) => lesson.date >= from && lesson.date <= to;
  const previous = new Map(before.filter(inRange).map((lesson) => [lessonKey(lesson), lesson]));
  const next = new Map(after.filter(inRange).map((lesson) => [lessonKey(lesson), lesson]));
  const changes = [];
  const identity = (left, right) => left.subject === right.subject && left.lessonType === right.lessonType
    && (left.subgroup ?? null) === (right.subgroup ?? null)
    && sameList([...(left.teachers ?? [])].sort(), [...(right.teachers ?? [])].sort());
  const removed = [...previous].filter(([key, lesson]) => !next.has(key) || !identity(lesson, next.get(key))).map(([, lesson]) => lesson);
  const added = [...next].filter(([key, lesson]) => !previous.has(key) || !identity(lesson, previous.get(key))).map(([, lesson]) => lesson);
  const moment = (lesson) => zonedMoment(lesson.date, String(lesson.time || '00:00').slice(0, 5), lesson.timeZone).getTime();
  const movedFrom = new Set();
  const movedTo = new Set();
  for (const lesson of removed) {
    const candidates = added.filter((item) => identity(lesson, item) && lessonKey(item) !== lessonKey(lesson))
      .sort((left, right) => Math.abs(moment(left) - moment(lesson)) - Math.abs(moment(right) - moment(lesson))
        || lessonKey(left).localeCompare(lessonKey(right)));
    const target = candidates[0];
    if (target) {
      changes.push({ type: 'moved', previous: lesson, lesson: target });
      movedFrom.add(lessonKey(lesson));
      movedTo.add(lessonKey(target));
      added.splice(added.indexOf(target), 1);
    }
  }
  for (const [key, lesson] of previous) {
    const current = next.get(key);
    if (movedFrom.has(key)) {
      if (current && !movedTo.has(key)) changes.push({ type: 'added', lesson: current });
      continue;
    }
    if (!current || movedTo.has(key)) changes.push({ type: 'cancelled', lesson });
    else if (current.subject !== lesson.subject || current.lessonType !== lesson.lessonType) changes.push({ type: 'subject', lesson: current, previous: lesson });
    else {
      if (!sameList(current.auditories, lesson.auditories)) changes.push({ type: 'room', lesson: current, previous: lesson });
      if (!sameList(current.teachers, lesson.teachers)) changes.push({ type: 'teacher', lesson: current, previous: lesson });
    }
  }
  for (const [key, lesson] of next) if (!previous.has(key) && !movedTo.has(key)) changes.push({ type: 'added', lesson });
  return changes.sort((left, right) => lessonKey(left.lesson).localeCompare(lessonKey(right.lesson)));
};

class SnapshotStore {
  #data = null;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async get(groupId) {
    await this.#load();
    return this.#data[groupKey(groupId)] ?? null;
  }

  async set(groupId, value) {
    await this.#load();
    this.#data[groupKey(groupId)] = value;
    this.#writeQueue = this.#writeQueue.then(() => this.#save());
    await this.#writeQueue;
  }

  async #load() {
    if (this.#data) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.#data = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'schemaVersion').map(([key, value]) => [groupKey(key), value]));
      if (parsed.schemaVersion !== 3) await this.#save();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#data = {};
    }
  }

  async #save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ ...this.#data, schemaVersion: 3 }), { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

export class NotificationService {
  #timers = [];
  #pendingHomework = new Map();
  #summaryRunning = false;
  #changesRunning = false;

  constructor({
    bot, service, preferences, community, snapshotsPath,
    now = () => new Date(), homeworkDelayMs = MINUTE, changesIntervalMs = 15 * MINUTE, recentIntervalMs = 3 * 60 * MINUTE, lessonChanges,
  }) {
    this.bot = bot;
    this.service = service;
    this.preferences = preferences;
    this.community = community;
    this.snapshots = new SnapshotStore(snapshotsPath);
    this.now = now;
    this.homeworkDelayMs = homeworkDelayMs;
    this.changesIntervalMs = changesIntervalMs;
    this.recentIntervalMs = recentIntervalMs;
    this.lessonChanges = lessonChanges;
  }

  start() {
    const every = (ms, task) => {
      const timer = setInterval(() => task().catch(console.error), ms);
      timer.unref();
      this.#timers.push(timer);
    };
    every(MINUTE, () => this.sendSummaries());
    every(MINUTE, () => this.sendExamReminders());
    every(MINUTE, () => this.sendScheduled());
    every(this.changesIntervalMs, () => this.checkChanges({ near: true }));
    every(this.recentIntervalMs, () => this.checkChanges());
    const first = setTimeout(() => this.checkChanges().catch(console.error), 5 * MINUTE);
    first.unref();
    this.#timers.push(first);
  }

  stop() {
    for (const timer of this.#timers) clearTimeout(timer);
    for (const { timer } of this.#pendingHomework.values()) clearTimeout(timer);
    this.#timers = [];
    this.#pendingHomework.clear();
  }

  async #recipients(groupId, kind) {
    return (await this.preferences.entries())
      .filter(([id, prefs]) => prefs.selection?.kind === 'group' && sameGroup(prefs.selection.id, groupId) && (!isDemo(groupId) || demoAllowed(id)))
      .filter(([, prefs]) => notificationEnabled(prefs, kind) && !isQuiet(prefs, this.now()))
      .map(([id, prefs]) => ({ id: Number(id), prefs }));
  }

  async #send(userId, lang, text, payload, buttonText, media = []) {
    const t = texts(lang);
    const button = this.bot.appButton?.(t, payload, buttonText);
    const attachments = [...media, ...(button ? [Keyboard.inlineKeyboard([[button]])] : [])];
    await this.bot.api.sendMessageToUser(userId, `${text}\n\n_${t.notifyFooter}_`, { format: 'markdown', attachments });
  }

  // Староста часто правит ДЗ несколько раз подряд — отправляем одно уведомление после паузы.
  homeworkSaved(item) {
    if (!item?.groupId) return;
    const key = `${item.groupId}:${item.lessonDate}:${item.lessonNumber}:${item.subgroup ?? 0}`;
    const current = this.#pendingHomework.get(key);
    if (current) clearTimeout(current.timer);
    const isUpdate = current?.isUpdate ?? (item.version ?? 1) > 1;
    const timer = setTimeout(() => {
      this.#pendingHomework.delete(key);
      this.notifyHomework(item, { isUpdate }).catch(console.error);
    }, isDemo(item.groupId) ? Math.min(2000, this.homeworkDelayMs) : this.homeworkDelayMs);
    timer.unref?.();
    this.#pendingHomework.set(key, { timer, isUpdate });
  }

  async notifyHomework(item, { isUpdate = false } = {}) {
    item = await withDeadline(item, this.service);
    const lesson = { date: item.lessonDate, lessonNumber: item.lessonNumber, subgroup: item.subgroup ?? null };
    const recipients = (await this.#recipients(item.groupId, 'homework'))
      .filter(({ id }) => String(id) !== String(item.authorId) && (!isDemo(item.groupId) || demoAllowed(id)))
      .filter(({ prefs }) => forSubgroup(prefs.subgroup, item.subgroup));
    const media = await this.bot.homeworkMedia?.(item) ?? [];
    for (const { id, prefs } of recipients) {
      const t = texts(prefs.lang);
      const local = item.lessonTime ? lessonInTimeZone({ date: item.lessonDate, time: item.lessonTime }, profileTimeZone(prefs)) : null;
      const when = `${shortDate(prefs.lang, local?.date ?? item.lessonDate)}, ${local?.time.slice(0, 5) ?? ''}`.replace(/, $/, '');
      const title = isUpdate ? t.updatedHomework(item.subject, when) : t.newHomework(item.subject, when);
      try {
        await this.#send(id, prefs.lang, `${title}\n\n${item.text}\n${detailsText(item, prefs.lang, profileTimeZone(prefs))}\n${attachmentSummary(item.attachments)}`, appPayload(lesson, prefs.selection.id), t.openLesson, media);
      } catch (error) {
        console.error(`Homework notification failed for user ${id}:`, error.message);
      }
    }
    if (item.attachments?.length) {
      for (const chat of await this.community.chatsForGroup(item.groupId)) {
        const t = texts(chat.lang);
        const app = this.bot.appButton?.(t, appPayload(lesson, item.groupId), t.openLesson);
        try {
          await this.bot.api.sendMessageToChat(chat.chatId, `${isUpdate ? t.updatedHomework(item.subject, item.lessonDate) : t.newHomework(item.subject, item.lessonDate)}\n${item.text}\n${detailsText(item, chat.lang)}\n${attachmentSummary(item.attachments)}`, {
            attachments: [...media, ...(app ? [Keyboard.inlineKeyboard([[app]])] : [])],
          });
        } catch (error) { console.error('Group homework notification failed:', error.message); }
      }
    }
    return recipients.length;
  }

  async sendSummaries() {
    if (this.#summaryRunning) return 0;
    this.#summaryRunning = true;
    let sent = 0;
    try {
      const now = this.now();
      const schedules = new Map();
      const users = (await this.preferences.entries())
        .filter(([id, prefs]) => prefs.selection?.kind === 'group' && notificationEnabled(prefs, 'summary') && (!isDemo(prefs.selection.id) || demoAllowed(id)))
        .filter(([, prefs]) => summaryDue(prefs, now) && prefs.summarySentFor !== zonedDateKey(now, profileTimeZone(prefs), 1));

      for (const [id, prefs] of users) {
        const tomorrow = zonedDateKey(now, profileTimeZone(prefs), 1);
        const groupId = prefs.selection.id;
        const cacheKey = `${groupId}:${prefs.subgroup ?? 0}:${tomorrow}:${profileTimeZone(prefs)}`;
        try {
          if (!schedules.has(cacheKey)) {
            schedules.set(cacheKey, userDayLessons(this.service, groupId, tomorrow, profileTimeZone(prefs), prefs.subgroup));
          }
          const lessons = await schedules.get(cacheKey);
          if (lessons.length) {
            const homework = await this.community.homeworkForUser(groupId, id, { from: lessons[0].date, to: lessons.at(-1).date, subgroup: prefs.subgroup });
            await this.#send(Number(id), prefs.lang, this.#summaryText(prefs.lang, tomorrow, lessons.map((lesson) => lessonInTimeZone(lesson, profileTimeZone(prefs))), homework), `day_${tomorrow}_${groupKey(groupId)}`, texts(prefs.lang).openDay);
            sent += 1;
          }
          await this.preferences.set(id, { ...await this.preferences.get(id), summarySentFor: tomorrow });
        } catch (error) {
          console.error(`Summary failed for user ${id}:`, error.message);
        }
      }
    } finally {
      this.#summaryRunning = false;
    }
    return sent;
  }

  // Экзамены и зачёты: напоминание за 3 дня и накануне, в то же время, что и сводка.
  async sendExamReminders() {
    const now = this.now();
    const schedules = new Map();
    const scheduleFor = (groupId, subgroup, dateKey, zone) => {
      const key = `${groupId}:${subgroup ?? 0}:${dateKey}:${zone}`;
      if (!schedules.has(key)) schedules.set(key, userDayLessons(this.service, groupId, dateKey, zone, subgroup));
      return schedules.get(key);
    };
    let sent = 0;
    const users = (await this.preferences.entries())
      .filter(([id, prefs]) => prefs.selection?.kind === 'group' && notificationEnabled(prefs, 'exams') && (!isDemo(prefs.selection.id) || demoAllowed(id)))
      .filter(([, prefs]) => summaryDue(prefs, now));
    for (const [id, prefs] of users) {
      const reminded = new Set(prefs.examReminders ?? []);
      const fresh = [];
      for (const days of EXAM_REMINDER_DAYS) {
        const dateKey = zonedDateKey(now, profileTimeZone(prefs), days);
        try {
          const lessons = (await scheduleFor(prefs.selection.id, prefs.subgroup ?? null, dateKey, profileTimeZone(prefs)))
            .map((lesson) => lessonInTimeZone(lesson, profileTimeZone(prefs)))
            .filter((lesson) => lesson.date === dateKey && CONTROL_TYPES.includes(String(lesson.lessonType).toLowerCase()));
          for (const lesson of lessons) {
            const key = `${groupKey(prefs.selection.id)}|${lessonKey(lesson)}:${days}`;
            if (reminded.has(key)) continue;
            const t = texts(prefs.lang);
            const text = t.examReminder(t.examIn(days), lessonTypeLabel(prefs.lang, lesson.lessonType), lesson.subject,
              `${shortDate(prefs.lang, lesson.date)}, ${lesson.time.slice(0, 5)}`, (lesson.auditories ?? []).join(', '));
            await this.#send(Number(id), prefs.lang, text, appPayload(lesson, prefs.selection.id), t.openLesson);
            fresh.push(key);
            sent += 1;
          }
        } catch (error) {
          console.error(`Exam reminder failed for user ${id}:`, error.message);
        }
      }
      if (fresh.length) {
        const current = await this.preferences.get(id);
        await this.preferences.set(id, { ...current, examReminders: [...(current.examReminders ?? []), ...fresh].slice(-50) });
      }
    }
    return sent;
  }

  // Новое объявление старосты — каждому в личку, кроме автора.
  async notifyAnnouncement(item) {
    const recipients = (await this.#recipients(item.groupId, 'announcements'))
      .filter(({ id }) => String(id) !== String(item.authorId) && (!isDemo(item.groupId) || demoAllowed(id)));
    for (const { id, prefs } of recipients) {
      const t = texts(prefs.lang);
      try {
        await this.#send(id, prefs.lang, t.announcementNew(item, this.#when(prefs.lang, item.remindAt, profileTimeZone(prefs))), 'plan', t.openPlanner);
      } catch (error) {
        console.error(`Announcement notification failed for user ${id}:`, error.message);
      }
    }
    return recipients.length;
  }

  #when(lang, iso, zone = 'Asia/Irkutsk') {
    if (!iso) return null;
    const date = new Date(iso);
    return `${shortDate(lang, zonedDateKey(date, zone))}, ${zonedClock(date, zone)}`;
  }

  // Напоминания «на время»: об объявлениях старосты и о ДЗ из планера.
  // У объявления время общее, но каждый может сдвинуть или выключить его у себя.
  async sendScheduled() {
    const now = this.now();
    let sent = 0;
    const announcements = await this.community.allAnnouncements();
    for (const [id, prefs] of await this.preferences.entries()) {
      if (prefs.selection?.kind !== 'group' || isQuiet(prefs, now) || (isDemo(prefs.selection.id) && !demoAllowed(id))) continue;
      const done = new Set(prefs.sentScheduled ?? []);
      const fresh = [];
      const t = texts(prefs.lang);
      const due = [];
      if (notificationEnabled(prefs, 'announcements')) {
        for (const item of announcements) {
          if (!sameGroup(item.groupId, prefs.selection.id)) continue;
          const own = prefs.announcementReminders?.[item.id];
          const at = own === undefined ? item.remindAt : own;
          if (!at || new Date(at) > now || now - new Date(at) > 6 * 60 * MINUTE) continue;
          const key = `${groupKey(prefs.selection.id)}|a:${item.id}:${at}`;
          if (!done.has(key)) due.push({ key, text: t.announcementReminder(item), payload: 'plan', label: t.openPlanner });
        }
      }
      if (notificationEnabled(prefs, 'homework')) {
        for (const [lessonKey, reminder] of Object.entries(prefs.homeworkReminders ?? {})) {
          if (reminder?.suspended) continue;
          const [date, lessonNumber, subgroup] = lessonKey.split(':');
          const lesson = { date, lessonNumber: Number(lessonNumber), subgroup: Number(subgroup) || null };
          const homework = (await this.community.homeworkForUser(prefs.selection.id, id, { from: date, to: date, subgroup: prefs.subgroup }))
            .find((item) => item.lessonNumber === lesson.lessonNumber && (item.subgroup ?? null) === lesson.subgroup);
          const at = reminder.mode?.startsWith('due-') ? dueReminderAt(homework ? (await withDeadline(homework, this.service)).dueAt : null, reminder.mode, prefs) : reminder.at;
          if (!at || new Date(at) > now || now - new Date(at) > 6 * 60 * MINUTE) continue;
          const key = `${groupKey(prefs.selection.id)}|h:${lessonKey}:${at}`;
          if (done.has(key)) continue;
          due.push({
            key,
            text: t.homeworkReminder(reminder.subject ?? homework?.subject ?? '', `${shortDate(prefs.lang, date)}, ${reminder.time ?? ''}`.replace(/, $/, ''), `${homework?.text ?? ''}\n${homework ? detailsText(await withDeadline(homework, this.service), prefs.lang, profileTimeZone(prefs)) : ''}`),
            payload: appPayload(lesson, prefs.selection.id),
            label: t.openLesson,
          });
        }
      }
      for (const item of due) {
        try {
          await this.#send(Number(id), prefs.lang, item.text, item.payload, item.label);
          fresh.push(item.key);
          sent += 1;
        } catch (error) {
          console.error(`Scheduled reminder failed for user ${id}:`, error.message);
        }
      }
      if (fresh.length) {
        const current = await this.preferences.get(id);
        await this.preferences.set(id, { ...current, sentScheduled: [...(current.sentScheduled ?? []), ...fresh].slice(-100) });
      }
    }
    return sent;
  }

  #summaryText(lang, dateKey, lessons, homework) {
    const t = texts(lang);
    const pairs = [...new Set(lessons.map((lesson) => lesson.lessonNumber))];
    const withHomework = homework.filter((item) => item.text);
    const subjects = [...new Set(withHomework.map((item) => item.subject))];
    const day = formatDate(lang, dateKey, { weekday: 'long', day: 'numeric', month: 'long' });
    return [
      t.summaryTitle(lang === 'ru' ? day.toLowerCase() : day),
      t.summaryLessons(pairs.length, lessons[0].time.slice(0, 5)),
      '',
      t.summaryHomework(new Set(withHomework.map((item) => item.lessonNumber)).size, pairs.length),
      ...subjects.map((subject) => `— ${subject}`),
    ].join('\n');
  }

  async checkChanges({ near = false } = {}) {
    if (this.#changesRunning) return 0;
    this.#changesRunning = true;
    let notified = 0;
    try {
      const now = this.now();
      const users = (await this.preferences.entries())
        .filter(([, prefs]) => prefs.selection?.kind === 'group');
      const groups = new Map();
      for (const [id, prefs] of users) {
        const list = groups.get(prefs.selection.id) ?? { title: prefs.selection.title, users: [] };
        list.users.push({ id: Number(id), prefs });
        groups.set(prefs.selection.id, list);
      }

      for (const chat of await this.community.allChats()) {
        if (chat.group && !groups.has(chat.group.id)) groups.set(chat.group.id, { title: chat.group.title, users: [] });
      }
      for (const [groupId, group] of groups) {
        const sourceZone = universityTimeZone(groupId);
        const from = zonedDateKey(now, sourceZone);
        const to = zonedDateKey(now, sourceZone, CHANGES_WINDOW_DAYS - 1);
        const recipients = group.users.filter(({ prefs }) => notificationEnabled(prefs, 'changes') && !isQuiet(prefs, now));

        const previous = await this.snapshots.get(groupId);
        const legacySnapshot = previous?.lessons.some((lesson) => typeof lesson.lessonType !== 'string');
        let lessons;
        try {
          const keys = near && previous && !legacySnapshot ? [from, zonedDateKey(now, sourceZone, 1)] : [from, zonedDateKey(now, sourceZone, 7), to];
          const weeks = await Promise.all([...new Set(keys.map((key) => { return startOfWeek(dateFromKey(key)).toISOString(); }))].map((key) =>
            this.service.groupSchedule(groupId, { week: new Date(key), raw: true, fresh: true })));
          if (weeks.some((week) => week.stale)) throw new Error('source_stale');
          const seen = new Set();
          lessons = weeks.flatMap((week) => week.lessons)
            .filter((lesson) => lesson.date >= from && lesson.date <= to)
            .filter((lesson) => !seen.has(lessonKey(lesson)) && seen.add(lessonKey(lesson)))
            .map(slim);
        } catch (error) {
          console.error(`Schedule check failed for group ${groupId}:`, error.message);
          continue;
        }

        if (near && previous && !legacySnapshot) {
          const weeks = new Set([from, zonedDateKey(now, sourceZone, 1)].map((key) => toDateKey(startOfWeek(dateFromKey(key)))));
          lessons = [...previous.lessons.filter((lesson) => !weeks.has(toDateKey(startOfWeek(dateFromKey(lesson.date)))) && lesson.date >= from && lesson.date <= to), ...lessons];
        }
        // Старый формат не сохранял тип занятия: сравнение сочло бы все пары заменёнными.
        // Первый новый снимок становится базой, ДЗ и уведомления при этом не меняются.
        if (!previous || legacySnapshot) {
          await this.snapshots.set(groupId, { schemaVersion: 2, from, to, takenAt: now.toISOString(), lessons });
          continue;
        }
        const range = { from: from > previous.from ? from : previous.from, to: to < previous.to ? to : previous.to };
        let changes = diffSchedules(previous.lessons, lessons, range);
        // Исчезновение сегодня может оказаться переносом на следующую неделю.
        // Дополнительные недели читаем только при таком изменении.
        if (near && changes.some((change) => ['cancelled', 'subject'].includes(change.type))) {
          try {
            const keys = [...new Set([from, zonedDateKey(now, sourceZone, 7), to].map((key) => toDateKey(startOfWeek(dateFromKey(key)))))];
            const weeks = await Promise.all(keys.map((key) => this.service.groupSchedule(groupId, { week: dateFromKey(key), raw: true, fresh: true })));
            const unique = new Map(weeks.flatMap((week) => week.lessons).filter((lesson) => lesson.date >= from && lesson.date <= to)
              .map((lesson) => [lessonKey(lesson), slim(lesson)]));
            lessons = [...unique.values()];
            changes = diffSchedules(previous.lessons, lessons, range);
          } catch (error) {
            // До успешной проверки диапазона не объявляем пару отменённой.
            console.error(`Move search failed for group ${groupId}:`, error.message);
            continue;
          }
        }
        const unresolved = (await this.community.orphanedLessons(groupId))
          .filter((source) => !lessons.some((lesson) => lessonKey(source) === lessonKey(lesson) && source.subject === lesson.subject));
        const recovered = diffSchedules(unresolved, changes.filter((change) => change.type === 'added').map((change) => change.lesson), range)
          .filter((change) => change.type === 'moved');
        const recoveredKeys = new Set(recovered.map((change) => lessonKey(change.lesson)));
        changes = [...changes.filter((change) => change.type !== 'added' || !recoveredKeys.has(lessonKey(change.lesson))), ...recovered];
        const visible = [];
        for (const change of changes) {
          const result = this.lessonChanges ? await this.lessonChanges.official(groupId, change, `${previous.takenAt}:${change.type}:${lessonKey(change.previous ?? change.lesson)}:${lessonKey(change.lesson)}`) : null;
          if (!result?.silent) visible.push({ ...change, homework: result?.homework });
        }
        await this.snapshots.set(groupId, { schemaVersion: 2, from, to, takenAt: now.toISOString(), lessons });
        if (!visible.length) continue;
        if (this.lessonChanges) await this.lessonChanges.notifyChats(groupId, visible);

        for (const { id, prefs } of recipients) {
          const own = visible.filter((change) => forSubgroup(prefs.subgroup, change.lesson.subgroup));
          if (!own.length) continue;
          try {
            await this.#send(id, prefs.lang, this.#changesText(prefs.lang, group.title, own.map((change) => ({ ...change, lesson: lessonInTimeZone(change.lesson, profileTimeZone(prefs)), previous: change.previous ? lessonInTimeZone(change.previous, profileTimeZone(prefs)) : undefined }))), `day_${lessonInTimeZone(own[0].lesson, profileTimeZone(prefs)).date}_${groupKey(groupId)}`, texts(prefs.lang).openDay);
            notified += 1;
          } catch (error) {
            console.error(`Changes notification failed for user ${id}:`, error.message);
          }
        }
      }
    } finally {
      this.#changesRunning = false;
    }
    return notified;
  }

  #changesText(lang, groupTitle, changes) {
    const t = texts(lang);
    const lines = changes.slice(0, 12).map(({ type, lesson, previous, homework }) => {
      const when = t.changeWhen(shortDate(lang, lesson.date), String(lesson.time ?? '').slice(0, 5));
      if (type === 'moved') return `— ${t.changeMoved(lesson.subject, `${shortDate(lang, previous.date)}, ${previous.time?.slice(0, 5)}`, when)}${homework ? `\n${t.homework}: ${homework}` : ''}`;
      if (type === 'cancelled') return `— ${t.changeCancelled(when, lesson.subject)}`;
      if (type === 'added') return `— ${t.changeAdded(when, lesson.subject)}`;
      if (type === 'subject') return `— ${t.changeSubject(when, previous.subject, lesson.subject)}`;
      if (type === 'room') return `— ${t.changeRoom(when, lesson.subject, previous.auditories.join(', '), lesson.auditories.join(', '))}`;
      return `— ${t.changeTeacher(when, lesson.subject, lesson.teachers.join(', '))}`;
    });
    if (changes.length > 12) lines.push(`— …+${changes.length - 12}`);
    return [t.changesTitle(groupTitle), '', ...lines].join('\n');
  }
}
