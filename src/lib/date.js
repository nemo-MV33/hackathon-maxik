const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const toDateKey = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDateKey = (value) => {
  if (!DATE_PATTERN.test(value ?? '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return toDateKey(date) === value ? date : null;
};

export const startOfWeek = (date = new Date()) => {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const distanceFromMonday = (result.getUTCDay() + 6) % 7;
  result.setUTCDate(result.getUTCDate() - distanceFromMonday);
  return result;
};

export const endOfWeek = (date = new Date()) => {
  const result = startOfWeek(date);
  result.setUTCDate(result.getUTCDate() + 6);
  return result;
};

export const addDays = (date, days) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

export const formatHumanDate = (dateKey) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parseDateKey(dateKey));
