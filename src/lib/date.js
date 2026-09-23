const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDateKey = (value) => {
  if (!DATE_PATTERN.test(value ?? '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return toDateKey(date) === value ? date : null;
};

export const startOfWeek = (date = new Date()) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const distanceFromMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - distanceFromMonday);
  return result;
};

export const endOfWeek = (date = new Date()) => {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + 6);
  return result;
};

export const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const formatHumanDate = (dateKey) =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parseDateKey(dateKey));
