import { formatHumanDate, toDateKey } from '../lib/date.js';

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const shortName = (name) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 3) return name;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
};

const formatLesson = (lesson, scheduleKind, displayNumber) => {
  const heading = `${displayNumber} пара · ${lesson.time}`;
  const type = [lesson.lessonType, lesson.subgroup ? `${lesson.subgroup} подгруппа` : '', lesson.transferred ? 'перенос' : '']
    .filter(Boolean)
    .join(' · ');
  const lines = [`**${heading}**`, lesson.subject, type];
  if (lesson.auditories.length) lines.push(`📍 ${lesson.auditories.join(', ')}`);
  if (lesson.teachers.length && scheduleKind !== 'teacher') {
    lines.push(`👤 ${lesson.teachers.map(shortName).join(', ')}`);
  }
  if (lesson.groups.length && scheduleKind !== 'group') lines.push(`🎓 ${lesson.groups.join(', ')}`);
  if (lesson.link) lines.push(`🔗 ${lesson.link}`);
  return lines.filter(Boolean).join('\n');
};

export const formatSchedule = (schedule, { date } = {}) => {
  const lessons = date
    ? schedule.lessons.filter((lesson) => lesson.date === toDateKey(date))
    : schedule.lessons;

  if (lessons.length === 0) {
    return date ? 'На этот день занятий нет 🎉' : 'На этой неделе занятий нет.';
  }

  const days = new Map();
  for (const lesson of lessons) {
    const day = days.get(lesson.date) ?? [];
    day.push(lesson);
    days.set(lesson.date, day);
  }

  return [...days.entries()].map(([dateKey, dayLessons]) => [
    `📅 **${capitalize(formatHumanDate(dateKey))}**`,
    '',
    dayLessons.map((lesson, index) => formatLesson(lesson, schedule.kind, index + 1)).join('\n\n'),
  ].join('\n')).join('\n\n──────────\n\n');
};

export const formatWeekTitle = (schedule) => {
  const from = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(schedule.period.from);
  const to = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(schedule.period.to);
  return `**Неделя ${from} — ${to} · ${schedule.weekEven ? 'чётная' : 'нечётная'}**`;
};

export const formatSearchResults = (title, items, label) => {
  if (!items.length) return `По запросу ничего не найдено. Попробуй написать ${label} иначе.`;
  return [title, '', ...items.map((item, index) => {
    const subtitle = item.institute || (item.fullName !== item.name ? item.name : '');
    return `${index + 1}. ${item.title || item.fullName}${subtitle ? ` — ${subtitle}` : ''}`;
  }), '', 'Выбери нужный вариант кнопкой ниже.'].join('\n');
};
