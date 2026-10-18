import { groupKey } from '../universities/identity.js';
import { universityTimeZone, zonedDateKey, zonedMoment, lessonInTimeZone, profileTimeZone } from '../lib/timezone.js';
import { Keyboard } from '@maxhub/max-bot-api';
import { texts } from '../bot/i18n.js';
import { dateFromKey } from '../lib/irkutsk.js';
import { isQuiet, endMinutes, notificationEnabled, reminderMinutes, remindersEnabled } from '../lib/settings.js';

const CHECK_INTERVAL_MS = 30_000;
const SENT_LIMIT = 100;

// Напоминания привязаны к парам: «за N минут до начала» и, по желанию, «за N минут до конца».
// Время каждый выбирает сам в настройках бота или мини-приложения.
export class ReminderService {
  #timer;
  #running = false;

  constructor({ bot, service, preferences, now = () => new Date() }) {
    this.bot = bot;
    this.service = service;
    this.preferences = preferences;
    this.now = now;
  }

  start() {
    this.#timer = setInterval(() => this.check().catch(console.error), CHECK_INTERVAL_MS);
    this.#timer.unref();
    this.check().catch(console.error);
  }

  stop() {
    clearInterval(this.#timer);
  }

  async check() {
    if (this.#running) return 0;
    this.#running = true;
    let sent = 0;
    try {
      const now = this.now();
      const schedules = new Map();
      for (const [id, profile] of await this.preferences.entries()) {
        if (profile.selection?.kind !== 'group' || isQuiet(profile, now)) continue;
        const sourceZone = universityTimeZone(profile.selection.id);
        const today = zonedDateKey(now, sourceZone);
        const wantStart = remindersEnabled(profile);
        const wantEnd = notificationEnabled(profile, 'lessonEnd');
        if (!wantStart && !wantEnd) continue;
        try {
          const cacheKey = `${profile.selection.id}:${profile.subgroup ?? 0}`;
          if (!schedules.has(cacheKey)) {
            const dates = [dateFromKey(today)];
            if (dates[0].getUTCDay() === 0) dates.push(dateFromKey(zonedDateKey(now, sourceZone, 1)));
            schedules.set(cacheKey, Promise.all(dates.map((week) => this.service.groupSchedule(profile.selection.id, { week, subgroup: profile.subgroup ?? null })))
              .then((weeks) => ({ lessons: weeks.flatMap((week) => week.lessons) })));
          }
          const lessons = (await schedules.get(cacheKey)).lessons;
          const due = [];
          for (const lesson of lessons) {
            const toStart = (zonedMoment(lesson.date, lesson.time.slice(0, 5), lesson.timeZone) - now) / 60_000;
            const toEnd = (zonedMoment(lesson.date, lesson.time.split(/[–-]/)[1], lesson.timeZone) - now) / 60_000;
            const before = reminderMinutes(profile);
            const beforeEnd = endMinutes(profile);
            if (wantStart && toStart <= before && toStart > before - 2) due.push({ lesson, kind: 'start', minutes: before });
            if (wantEnd && toEnd <= beforeEnd && toEnd > beforeEnd - 2) due.push({ lesson, kind: 'end', minutes: beforeEnd });
          }
          for (const { lesson, kind, minutes } of due) {
            const key = `${groupKey(profile.selection.id)}|${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}:${kind}`;
            const current = await this.preferences.get(id);
            const already = current.sentReminders ?? [];
            if (already.includes(key)) continue;
            const t = texts(current.lang);
            const place = (lesson.auditories ?? []).join(', ');
            const text = kind === 'start'
              ? t.reminder(lesson.subject, lessonInTimeZone(lesson, profileTimeZone(profile)).time, place, minutes)
              : t.endReminder(lesson.subject, minutes);
            const button = kind === 'start'
              ? this.bot.appButton?.(t, `lesson_${lesson.date}_${lesson.lessonNumber}_${lesson.subgroup ?? 0}_${profile.selection.id}`, t.openLesson)
              : null;
            await this.bot.api.sendMessageToUser(Number(id), text, {
              format: 'markdown', attachments: button ? [Keyboard.inlineKeyboard([[button]])] : [],
            });
            await this.preferences.set(id, { ...current, sentReminders: [...already.slice(-(SENT_LIMIT - 1)), key] });
            sent += 1;
          }
        } catch (error) {
          console.error(`Reminder check failed for user ${id}:`, error.message);
        }
      }
    } finally {
      this.#running = false;
    }
    return sent;
  }
}
