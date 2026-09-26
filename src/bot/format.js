import { toDateKey } from '../lib/date.js';
import { lessonTypeLabel, texts } from './i18n.js';

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
// В русском месяц и день недели внутри фразы пишутся со строчной, в английском — нет.
const inline = (language, value) => (language === 'ru' ? value.toLowerCase() : value);
const shortName = (name) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 3) return name;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
};

export const formatDate = (language, dateKey, options = { weekday: 'long', day: 'numeric', month: 'long' }) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return capitalize(new Intl.DateTimeFormat(texts(language).locale, { ...options, timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day))));
};

const formatLesson = (language, lesson, scheduleKind) => {
  const t = texts(language);
  const details = [
    lessonTypeLabel(language, lesson.lessonType),
    lesson.subgroup ? t.subgroupShort(lesson.subgroup) : '',
    lesson.transferred ? t.transferred : '',
  ].filter(Boolean).join(', ');
  const where = [
    lesson.auditories.join(', '),
    scheduleKind !== 'teacher' ? lesson.teachers.map(shortName).join(', ') : '',
    scheduleKind !== 'group' ? lesson.groups.join(', ') : '',
  ].filter(Boolean).join(' · ');
  return [
    t.lessonHeading(lesson.lessonNumber, lesson.time),
    `${lesson.subject}${details ? ` _(${details})_` : ''}`,
    where,
    lesson.link ?? '',
  ].filter(Boolean).join('\n');
};

const dayLabel = (language, dateKey, today) => {
  const t = texts(language);
  if (!today) return null;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateKey === toDateKey(today)) return t.todayLabel;
  if (dateKey === toDateKey(tomorrow)) return t.tomorrowLabel;
  return null;
};

const formatDay = (language, dateKey, lessons, kind, today) => {
  const t = texts(language);
  const label = dayLabel(language, dateKey, today);
  const date = formatDate(language, dateKey, label
    ? { day: 'numeric', month: 'long' }
    : { weekday: 'long', day: 'numeric', month: 'long' });
  return [
    t.dayTitle(label, label ? inline(language, date) : date),
    lessons.length ? '' : t.noLessonsDay,
    ...lessons.map((lesson) => `${formatLesson(language, lesson, kind)}\n`),
  ].join('\n').trim();
};

export const formatScheduleDay = (language, schedule, date, { title, today = new Date() } = {}) => {
  const key = toDateKey(date);
  const lessons = schedule.lessons.filter((lesson) => lesson.date === key);
  return [title, formatDay(language, key, lessons, schedule.kind, today)].filter(Boolean).join('\n\n');
};

export const formatScheduleWeek = (language, schedule, { title, today = new Date() } = {}) => {
  const t = texts(language);
  const from = toDateKey(schedule.period.from);
  const to = toDateKey(schedule.period.to);
  const long = { day: 'numeric', month: 'long' };
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const heading = t.weekTitle(
    sameMonth ? String(Number(from.slice(8))) : inline(language, formatDate(language, from, long)),
    inline(language, formatDate(language, to, long)),
    schedule.weekEven,
  );
  const days = new Map();
  for (const lesson of schedule.lessons) days.set(lesson.date, [...(days.get(lesson.date) ?? []), lesson]);
  const body = days.size
    ? [...days.entries()].map(([key, lessons]) => formatDay(language, key, lessons, schedule.kind, today)).join('\n\n')
    : t.noLessonsWeek;
  return [title, heading, body].filter(Boolean).join('\n\n');
};

export const formatHomework = (language, items) => {
  const t = texts(language);
  if (!items.length) return `${t.homeworkTitle}\n\n${t.homeworkEmpty}`;
  return [t.homeworkTitle, ...items.map((item) => [
    `**${item.subject}** · ${formatDate(language, item.lessonDate, { weekday: 'short', day: 'numeric', month: 'short' })}, ${item.lessonTime.slice(0, 5)}`,
    item.text,
    item.source === 'personal' ? t.homeworkPersonalMark : '',
  ].filter(Boolean).join('\n'))].join('\n\n');
};
