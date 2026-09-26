import { t } from './i18n';

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

// Форматтеры берут язык из i18n при каждом вызове: компоненты перерисовываются при смене языка.
const format = (options: Intl.DateTimeFormatOptions, date: Date) =>
  new Intl.DateTimeFormat(t().locale, options).format(date);

export const formatDay = (date: Date) =>
  format({ weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }, date);

export const formatUpdatedAt = (iso: string) =>
  `${format({ day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Irkutsk' }, new Date(iso))} (${t().irkutsk})`;

export const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

export const clockLabel = (now: Date) => now.toISOString().slice(11, 16);

export const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const { hours: h, minutes: m } = t();
  return [hours && `${hours} ${h}`, rest && `${rest} ${m}`].filter(Boolean).join(' ') || `0 ${m}`;
};

const monthShortLabel = (date: Date) => format({ month: 'short', timeZone: 'UTC' }, date).replace('.', '');

export const formatRange = (from: Date, to: Date) => {
  const sameMonth = from.getUTCMonth() === to.getUTCMonth();
  return sameMonth
    ? `${from.getUTCDate()}–${to.getUTCDate()} ${monthShortLabel(to)}`
    : `${from.getUTCDate()} ${monthShortLabel(from)} – ${to.getUTCDate()} ${monthShortLabel(to)}`;
};

export const formatStamp = (iso: string) =>
  format({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Irkutsk' }, new Date(iso)).replace('.', '');
