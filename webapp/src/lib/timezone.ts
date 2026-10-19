import type { Lesson } from '../data/schedule';
import { groupTimeZone } from './universities';
const KEY = 'norfly.timeZone';
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Irkutsk';
export const userTimeZone = () => { try { return localStorage.getItem(KEY) || deviceTimeZone(); } catch { return deviceTimeZone(); } };
export const saveTimeZone = (zone: string) => { localStorage.setItem(KEY, zone); window.dispatchEvent(new Event('norfly:timezone')); };
export const dateInZone = (date: Date, timeZone = userTimeZone()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
export const clockInZone = (date: Date, timeZone = userTimeZone()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
export const localMoment = (key: string, time: string, timeZone = userTimeZone()) => {
  const target = Date.parse(`${key}T${time.slice(0, 5)}:00Z`);
  let value = target;
  for (let i = 0; i < 4; i += 1) {
    const instant = new Date(value);
    const delta = target - Date.parse(`${dateInZone(instant, timeZone)}T${clockInZone(instant, timeZone)}:00Z`);
    if (!delta) return instant.toISOString();
    value += delta;
  }
  throw new Error('nonexistent_local_time');
};
export const lessonMoment = (lesson: Lesson, end = false) => (end ? lesson.endsAt : lesson.startsAt)
  || localMoment(lesson.date, end ? lesson.time.slice(6, 11) : lesson.time.slice(0, 5), lesson.timeZone || groupTimeZone(lesson.groupId));
export const lessonDate = (lesson: Lesson) => dateInZone(new Date(lessonMoment(lesson)));
export const lessonTime = (lesson: Lesson) => `${clockInZone(new Date(lessonMoment(lesson)))}–${clockInZone(new Date(lessonMoment(lesson, true)))}`;
