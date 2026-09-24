// Расписание ИРНИТУ задано по иркутскому времени (UTC+8, без перехода на летнее).
// Даты храним как «иркутские часы» в UTC-полях Date, поэтому результат
// не зависит от часового пояса телефона: в Москве и в Иркутске всё совпадает.
const IRKUTSK_OFFSET_MS = 8 * 60 * 60 * 1000;

export const irkutskNow = () => new Date(Date.now() + IRKUTSK_OFFSET_MS);

export const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

export const fromDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export const startOfWeek = (date: Date) => {
  const day = fromDateKey(toDateKey(date));
  return addDays(day, -((day.getUTCDay() + 6) % 7));
};

const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});
const shortFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const updatedFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Irkutsk',
});

export const formatDay = (date: Date) => dayFormat.format(date);
export const formatShortDay = (date: Date) => shortFormat.format(date);
export const formatUpdatedAt = (iso: string) => `${updatedFormat.format(new Date(iso))} (Иркутск)`;

export const minutesUntil = (dateKey: string, time: string, now = irkutskNow()) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  const start = fromDateKey(dateKey).getTime() + (hours * 60 + minutes) * 60_000;
  return Math.round((start - now.getTime()) / 60_000);
};
