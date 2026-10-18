import { university } from '../universities/config.js';
import { splitGroupKey } from '../universities/identity.js';
export const DEFAULT_TIME_ZONE = 'Asia/Irkutsk';
export const validTimeZone = (value) => {
  if (typeof value !== 'string') return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
};
const parts = (date, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(date).filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
export const zonedDateKey = (date = new Date(), timeZone = DEFAULT_TIME_ZONE, offsetDays = 0) => {
  const { year, month, day } = parts(date, timeZone);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + offsetDays)).toISOString().slice(0, 10);
};
export const zonedClock = (date, timeZone = DEFAULT_TIME_ZONE) => {
  const { hour, minute } = parts(date, timeZone);
  return `${hour}:${minute}`;
};
export const zonedMinutes = (date, timeZone = DEFAULT_TIME_ZONE) => {
  const { hour, minute } = parts(date, timeZone);
  return Number(hour) * 60 + Number(minute);
};
// Intl учитывает правила IANA, включая сезонные смещения. Несуществующее местное время отвергается.
export const zonedMoment = (key, time, timeZone = DEFAULT_TIME_ZONE) => {
  const target = Date.parse(`${key}T${time.slice(0, 5)}:00Z`);
  if (!Number.isFinite(target)) throw new Error('invalid_local_time');
  let timestamp = target;
  for (let i = 0; i < 4; i += 1) {
    const p = parts(new Date(timestamp), timeZone);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const delta = target - represented;
    if (!delta) return new Date(timestamp);
    timestamp += delta;
  }
  throw new Error('nonexistent_local_time');
};
export const universityTimeZone = (groupId) => university(splitGroupKey(groupId).universityId).timeZone;
export const profileTimeZone = (prefs) => prefs.timeZone || university(prefs.selection?.kind === 'group' ? splitGroupKey(prefs.selection.id).universityId : prefs.universityId || 'irnitu').timeZone;
export const lessonMoments = (lesson, timeZone = DEFAULT_TIME_ZONE) => {
  const [start, end = start] = lesson.time.split(/[–-]/);
  return { ...lesson, timeZone, startsAt: zonedMoment(lesson.date, start, timeZone).toISOString(),
    endsAt: zonedMoment(lesson.date, end, timeZone).toISOString() };
};
export const lessonInTimeZone = (lesson, timeZone) => {
  const value = lesson.startsAt ? lesson : lessonMoments(lesson, lesson.timeZone);
  return { ...value, universityDate: lesson.date, universityTime: lesson.time,
    date: zonedDateKey(new Date(value.startsAt), timeZone),
    time: `${zonedClock(new Date(value.startsAt), timeZone)}–${zonedClock(new Date(value.endsAt), timeZone)}` };
};
