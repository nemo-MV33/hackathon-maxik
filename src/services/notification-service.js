import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Keyboard } from '@maxhub/max-bot-api';
import { CONTROL_TYPES } from '../bot/create-bot.js';
import { formatDate } from '../bot/format.js';
import { lessonTypeLabel, texts } from '../bot/i18n.js';
import { dateFromKey, irkutskClock, irkutskDateKey, irkutskMinutes } from '../lib/irkutsk.js';
import { notificationEnabled, summaryTime, timeToMinutes } from '../lib/settings.js';

// Сводка и напоминания о контрольных приходят во время, которое выбрал пользователь (по умолчанию 20:00).
const summaryDue = (prefs, now) => irkutskMinutes(now) >= timeToMinutes(summaryTime(prefs));
const EXAM_REMINDER_DAYS = [3, 1];
const CHANGES_WINDOW_DAYS = 7;
const MINUTE = 60_000;

const lessonKey = (lesson) => `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;
const appPayload = (lesson) => `lesson_${lesson.date}_${lesson.lessonNumber}_${lesson.subgroup ?? 0}`;
const forSubgroup = (subgroup, lessonSubgroup) => !subgroup || !lessonSubgroup || lessonSubgroup === subgroup;
const shortDate = (lang, key) => formatDate(lang, key, { weekday: 'short', day: 'numeric', month: 'short' });
const sameList = (left = [], right = []) => left.join('|') === right.join('|');

const slim = (lesson) => ({
  date: lesson.date,
  lessonNumber: lesson.lessonNumber,
  subgroup: lesson.subgroup ?? null,
  subject: lesson.subject,
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
  for (const [key, lesson] of previous) {
    const current = next.get(key);
    if (!current) changes.push({ type: 'cancelled', lesson });
    else if (current.subject !== lesson.subject) changes.push({ type: 'subject', lesson: current, previous: lesson });
    else {
      if (!sameList(current.auditories, lesson.auditories)) changes.push({ type: 'room', lesson: current, previous: lesson });
      if (!sameList(current.teachers, lesson.teachers)) changes.push({ type: 'teacher', lesson: current, previous: lesson });
    }
  }
  for (const [key, lesson] of next) if (!previous.has(key)) changes.push({ type: 'added', lesson });
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
    return this.#data[String(groupId)] ?? null;
  }

  async set(groupId, value) {
    await this.#load();
    this.#data[String(groupId)] = value;
    this.#writeQueue = this.#writeQueue.then(() => this.#save());
    await this.#writeQueue;
  }

  async #load() {
    if (this.#data) return;
    try {
      this.#data = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#data = {};
    }
  }

  async #save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.#data), { mode: 0o600 });
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
    now = () => new Date(), homeworkDelayMs = MINUTE, changesIntervalMs = 3 * 60 * MINUTE,
  }) {
    this.bot = bot;
    this.service = service;
    this.preferences = preferences;
    this.community = community;
    this.snapshots = new SnapshotStore(snapshotsPath);
    this.now = now;
    this.homeworkDelayMs = homeworkDelayMs;
    this.changesIntervalMs = changesIntervalMs;
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
    every(this.changesIntervalMs, () => this.checkChanges());
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
      .filter(([, prefs]) => prefs.selection?.kind === 'group' && String(prefs.selection.id) === String(groupId))
      .filter(([, prefs]) => notificationEnabled(prefs, kind))
      .map(([id, prefs]) => ({ id: Number(id), prefs }));
  }

  async #send(userId, lang, text, payload, buttonText) {
    const t = texts(lang);
    const button = this.bot.appButton?.(t, payload, buttonText);
    const attachments = button ? [Keyboard.inlineKeyboard([[button]])] : [];
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
    }, this.homeworkDelayMs);
    timer.unref?.();
    this.#pendingHomework.set(key, { timer, isUpdate });
  }

  async notifyHomework(item, { isUpdate = false } = {}) {
    const lesson = { date: item.lessonDate, lessonNumber: item.lessonNumber, subgroup: item.subgroup ?? null };
    const recipients = (await this.#recipients(item.groupId, 'homework'))
      .filter(({ id }) => String(id) !== String(item.authorId))
      .filter(({ prefs }) => forSubgroup(prefs.subgroup, item.subgroup));
    for (const { id, prefs } of recipients) {
      const t = texts(prefs.lang);
      const when = `${shortDate(prefs.lang, item.lessonDate)}, ${item.lessonTime?.slice(0, 5) ?? ''}`.replace(/, $/, '');
      const title = isUpdate ? t.updatedHomework(item.subject, when) : t.newHomework(item.subject, when);
      try {
        await this.#send(id, prefs.lang, `${title}\n\n${item.text}`, appPayload(lesson), t.openLesson);
      } catch (error) {
        console.error(`Homework notification failed for user ${id}:`, error.message);
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
      const tomorrow = irkutskDateKey(now, 1);
      const schedules = new Map();
      const users = (await this.preferences.entries())
        .filter(([, prefs]) => prefs.selection?.kind === 'group' && notificationEnabled(prefs, 'summary'))
        .filter(([, prefs]) => summaryDue(prefs, now) && prefs.summarySentFor !== tomorrow);

      for (const [id, prefs] of users) {
        const groupId = prefs.selection.id;
        const cacheKey = `${groupId}:${prefs.subgroup ?? 0}`;
        try {
          if (!schedules.has(cacheKey)) {
            schedules.set(cacheKey, this.service.groupSchedule(groupId, { week: dateFromKey(tomorrow), subgroup: prefs.subgroup ?? null }));
          }
          const lessons = (await schedules.get(cacheKey)).lessons.filter((lesson) => lesson.date === tomorrow);
          if (lessons.length) {
            const homework = await this.community.homeworkForUser(groupId, id, { from: tomorrow, to: tomorrow, subgroup: prefs.subgroup });
            await this.#send(Number(id), prefs.lang, this.#summaryText(prefs.lang, tomorrow, lessons, homework), `day_${tomorrow}`, texts(prefs.lang).openDay);
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
    const scheduleFor = (groupId, subgroup, dateKey) => {
      const key = `${groupId}:${subgroup ?? 0}:${dateKey}`;
      if (!schedules.has(key)) schedules.set(key, this.service.groupSchedule(groupId, { week: dateFromKey(dateKey), subgroup }));
      return schedules.get(key);
    };
    let sent = 0;
    const users = (await this.preferences.entries())
      .filter(([, prefs]) => prefs.selection?.kind === 'group' && notificationEnabled(prefs, 'exams'))
      .filter(([, prefs]) => summaryDue(prefs, now));
    for (const [id, prefs] of users) {
      const reminded = new Set(prefs.examReminders ?? []);
      const fresh = [];
      for (const days of EXAM_REMINDER_DAYS) {
        const dateKey = irkutskDateKey(now, days);
        try {
          const lessons = (await scheduleFor(prefs.selection.id, prefs.subgroup ?? null, dateKey)).lessons
            .filter((lesson) => lesson.date === dateKey && CONTROL_TYPES.includes(String(lesson.lessonType).toLowerCase()));
          for (const lesson of lessons) {
            const key = `${lessonKey(lesson)}:${days}`;
            if (reminded.has(key)) continue;
            const t = texts(prefs.lang);
            const text = t.examReminder(t.examIn(days), lessonTypeLabel(prefs.lang, lesson.lessonType), lesson.subject,
              `${shortDate(prefs.lang, lesson.date)}, ${lesson.time.slice(0, 5)}`, (lesson.auditories ?? []).join(', '));
            await this.#send(Number(id), prefs.lang, text, appPayload(lesson), t.openLesson);
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
      .filter(({ id }) => String(id) !== String(item.authorId));
    for (const { id, prefs } of recipients) {
      const t = texts(prefs.lang);
      try {
        await this.#send(id, prefs.lang, t.announcementNew(item, this.#when(prefs.lang, item.remindAt)), 'plan', t.openPlanner);
      } catch (error) {
        console.error(`Announcement notification failed for user ${id}:`, error.message);
      }
    }
    return recipients.length;
  }

  #when(lang, iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return `${shortDate(lang, irkutskDateKey(date))}, ${irkutskClock(date)}`;
  }

  // Напоминания «на время»: об объявлениях старосты и о ДЗ из планера.
  // У объявления время общее, но каждый может сдвинуть или выключить его у себя.
  async sendScheduled() {
    const now = this.now();
    let sent = 0;
    const announcements = await this.community.allAnnouncements();
    for (const [id, prefs] of await this.preferences.entries()) {
      if (prefs.selection?.kind !== 'group') continue;
      const done = new Set(prefs.sentScheduled ?? []);
      const fresh = [];
      const t = texts(prefs.lang);
      const due = [];
      if (notificationEnabled(prefs, 'announcements')) {
        for (const item of announcements) {
          if (String(item.groupId) !== String(prefs.selection.id)) continue;
          const own = prefs.announcementReminders?.[item.id];
          const at = own === undefined ? item.remindAt : own;
          if (!at || new Date(at) > now || now - new Date(at) > 6 * 60 * MINUTE) continue;
          const key = `a:${item.id}:${at}`;
          if (!done.has(key)) due.push({ key, text: t.announcementReminder(item), payload: 'plan', label: t.openPlanner });
        }
      }
      if (notificationEnabled(prefs, 'homework')) {
        for (const [lessonKey, reminder] of Object.entries(prefs.homeworkReminders ?? {})) {
          if (!reminder?.at || new Date(reminder.at) > now || now - new Date(reminder.at) > 6 * 60 * MINUTE) continue;
          const key = `h:${lessonKey}:${reminder.at}`;
          if (done.has(key)) continue;
          const [date, lessonNumber, subgroup] = lessonKey.split(':');
          const lesson = { date, lessonNumber: Number(lessonNumber), subgroup: Number(subgroup) || null };
          const homework = (await this.community.homeworkForUser(prefs.selection.id, id, { from: date, to: date, subgroup: prefs.subgroup }))
            .find((item) => item.lessonNumber === lesson.lessonNumber);
          due.push({
            key,
            text: t.homeworkReminder(reminder.subject ?? homework?.subject ?? '', `${shortDate(prefs.lang, date)}, ${reminder.time ?? ''}`.replace(/, $/, ''), homework?.text),
            payload: appPayload(lesson),
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
      ...subjects.map((subject) => `· ${subject}`),
    ].join('\n');
  }

  async checkChanges() {
    if (this.#changesRunning) return 0;
    this.#changesRunning = true;
    let notified = 0;
    try {
      const now = this.now();
      const from = irkutskDateKey(now);
      const to = irkutskDateKey(now, CHANGES_WINDOW_DAYS - 1);
      const users = (await this.preferences.entries())
        .filter(([, prefs]) => prefs.selection?.kind === 'group');
      const groups = new Map();
      for (const [id, prefs] of users) {
        const list = groups.get(prefs.selection.id) ?? { title: prefs.selection.title, users: [] };
        list.users.push({ id: Number(id), prefs });
        groups.set(prefs.selection.id, list);
      }

      for (const [groupId, group] of groups) {
        const recipients = group.users.filter(({ prefs }) => notificationEnabled(prefs, 'changes'));
        if (!recipients.length) continue;
        let lessons;
        try {
          const weeks = await Promise.all([from, irkutskDateKey(now, 7)].map((key) =>
            this.service.groupSchedule(groupId, { week: dateFromKey(key) })));
          const seen = new Set();
          lessons = weeks.flatMap((week) => week.lessons)
            .filter((lesson) => lesson.date >= from && lesson.date <= to)
            .filter((lesson) => !seen.has(lessonKey(lesson)) && seen.add(lessonKey(lesson)))
            .map(slim);
        } catch (error) {
          console.error(`Schedule check failed for group ${groupId}:`, error.message);
          continue;
        }

        const previous = await this.snapshots.get(groupId);
        await this.snapshots.set(groupId, { from, to, takenAt: now.toISOString(), lessons });
        if (!previous) continue;
        const range = { from: from > previous.from ? from : previous.from, to: to < previous.to ? to : previous.to };
        const changes = diffSchedules(previous.lessons, lessons, range);
        if (!changes.length) continue;

        for (const { id, prefs } of recipients) {
          const own = changes.filter((change) => forSubgroup(prefs.subgroup, change.lesson.subgroup));
          if (!own.length) continue;
          try {
            await this.#send(id, prefs.lang, this.#changesText(prefs.lang, group.title, own), `day_${own[0].lesson.date}`, texts(prefs.lang).openDay);
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
    const lines = changes.slice(0, 12).map(({ type, lesson, previous }) => {
      const when = t.changeWhen(shortDate(lang, lesson.date), String(lesson.time ?? '').slice(0, 5));
      if (type === 'cancelled') return `· ${t.changeCancelled(when, lesson.subject)}`;
      if (type === 'added') return `· ${t.changeAdded(when, lesson.subject)}`;
      if (type === 'subject') return `· ${t.changeSubject(when, previous.subject, lesson.subject)}`;
      if (type === 'room') return `· ${t.changeRoom(when, lesson.subject, previous.auditories.join(', '), lesson.auditories.join(', '))}`;
      return `· ${t.changeTeacher(when, lesson.subject, lesson.teachers.join(', '))}`;
    });
    if (changes.length > 12) lines.push(`· …+${changes.length - 12}`);
    return [t.changesTitle(groupTitle), '', ...lines].join('\n');
  }
}
