// Расписание ИРНИТУ живёт по иркутскому времени, а сервер может стоять в любом часовом поясе.
const TIME_ZONE = 'Asia/Irkutsk';

const parts = (date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
);

export const irkutskDateKey = (date = new Date(), offsetDays = 0) => {
  const { year, month, day } = parts(date);
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + offsetDays));
  return shifted.toISOString().slice(0, 10);
};

export const irkutskMinutes = (date = new Date()) => {
  const { hour, minute } = parts(date);
  return Number(hour) * 60 + Number(minute);
};

export const dateFromKey = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
};

export const timeToMinutes = (time) => {
  const [hours, minutes] = String(time).slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

export const lessonEndMinutes = (lesson) => timeToMinutes(String(lesson.time).split(/[–-]/)[1] ?? lesson.time);

// «2026-09-28» + «13:30» по Иркутску → момент времени (Иркутск — UTC+8 без перехода на летнее время).
export const irkutskMoment = (dateKey, time) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes));
};

export const irkutskClock = (date) => {
  const { hour, minute } = parts(date);
  return `${hour}:${minute}`;
};
