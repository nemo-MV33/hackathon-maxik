import { texts } from '../bot/i18n.js';

const CHECK_INTERVAL_MS = 30_000;
const TIME_ZONE = 'Asia/Irkutsk';

const localParts = (date = new Date()) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
);

const currentIrkutskDate = () => {
  const parts = localParts();
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
};

const dateKey = (parts) => `${parts.year}-${parts.month}-${parts.day}`;
const minutesNow = (parts) => Number(parts.hour) * 60 + Number(parts.minute);
const startMinutes = (lesson) => {
  const [hours, minutes] = lesson.time.split(/[–-]/)[0].split(':').map(Number);
  return hours * 60 + minutes;
};

export class ReminderService {
  #timer;
  #running = false;

  constructor({ bot, service, preferences }) {
    this.bot = bot;
    this.service = service;
    this.preferences = preferences;
  }

  start() {
    this.#timer = setInterval(() => this.#check().catch(console.error), CHECK_INTERVAL_MS);
    this.#timer.unref();
    this.#check().catch(console.error);
  }

  stop() {
    clearInterval(this.#timer);
  }

  async #check() {
    if (this.#running) return;
    this.#running = true;
    try {
      const now = localParts();
      const today = dateKey(now);
      const currentMinutes = minutesNow(now);
      const users = await this.preferences.entries();

      for (const [id, profile] of users) {
        if (profile.remindersEnabled === false || profile.selection?.kind !== 'group') continue;
        try {
          const schedule = await this.service.groupSchedule(profile.selection.id, {
            week: currentIrkutskDate(), subgroup: profile.subgroup,
          });
          for (const lesson of schedule.lessons.filter((item) => item.date === today)) {
            const beforeStart = startMinutes(lesson) - currentMinutes;
            if (beforeStart < 14 || beforeStart > 15) continue;
            const reminderKey = `${lesson.date}:${lesson.id}:${lesson.lessonNumber}`;
            const sent = profile.sentReminders ?? [];
            if (sent.includes(reminderKey)) continue;
            await this.bot.api.sendMessageToUser(
              Number(id),
              texts(profile.lang).reminder(lesson.subject, lesson.time, lesson.auditories.join(', ')),
              { format: 'markdown' },
            );
            profile.sentReminders = [...sent.slice(-99), reminderKey];
            await this.preferences.set(id, profile);
          }
        } catch (error) {
          console.error(`Reminder check failed for user ${id}:`, error);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
