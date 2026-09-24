export const toDateKey = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

export const fromDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const startOfWeek = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(result, -((result.getDay() + 6) % 7));
};

const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric' });

export const formatDay = (date: Date) => dayFormat.format(date);
export const formatShortDay = (date: Date) => shortFormat.format(date);

export const minutesUntil = (dateKey: string, time: string, now = new Date()) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  const start = fromDateKey(dateKey);
  start.setHours(hours, minutes);
  return Math.round((start.getTime() - now.getTime()) / 60_000);
};
