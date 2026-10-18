// Совместимость со старыми импортами. Новые сценарии используют lib/timezone.js.
import { zonedClock, zonedDateKey, zonedMinutes, zonedMoment } from './timezone.js';
export const irkutskDateKey = (date = new Date(), offsetDays = 0) => zonedDateKey(date, 'Asia/Irkutsk', offsetDays);
export const irkutskMinutes = (date = new Date()) => zonedMinutes(date);
export const irkutskClock = (date) => zonedClock(date);
export const irkutskMoment = (key, time) => zonedMoment(key, time);
export const dateFromKey = (key) => new Date(`${key}T00:00:00Z`);
export const timeToMinutes = (time) => { const [h, m] = String(time).slice(0, 5).split(':').map(Number); return h * 60 + m; };
export const lessonEndMinutes = (lesson) => timeToMinutes(String(lesson.time).split(/[–-]/)[1] ?? lesson.time);
