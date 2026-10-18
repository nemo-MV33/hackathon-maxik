import { lessonDate } from './timezone';
import { loadMeta, loadWeek, type Lesson } from '../data/schedule';
import { addDays, fromDateKey, startOfWeek, toDateKey } from './date';

export const forSubgroup = (lessons: Lesson[], subgroup: 1 | 2 | null) =>
  lessons.filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup);

const byTime = (left: Lesson, right: Lesson) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`);

// Пары за период из уже выгруженных недель. Недели, которых нет в выгрузке, просто пропускаем.
export const loadLessons = async (groupId: string | number, subgroup: 1 | 2 | null, fromKey: string, toKey: string) => {
  const meta = await loadMeta();
  const firstWeek = toDateKey(startOfWeek(fromDateKey(fromKey)));
  const weeks = meta.weeks.filter((week) => week >= firstWeek && week <= toKey);
  const loaded = await Promise.all(weeks.map((week) => loadWeek(groupId, week)));
  const lessons = loaded.flatMap((week) => (week ? forSubgroup(week.lessons, subgroup) : []))
    .filter((lesson) => lessonDate(lesson) >= fromKey && lessonDate(lesson) <= toKey)
    .sort(byTime);
  return [...new Map(lessons.map((lesson) => [`${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}:${lesson.subject}`, lesson])).values()];
};

export const loadSemesterLessons = async (groupId: string | number, subgroup: 1 | 2 | null) => {
  const meta = await loadMeta();
  const last = meta.weeks.at(-1);
  if (!last) return [];
  return loadLessons(groupId, subgroup, meta.weeks[0], toDateKey(addDays(fromDateKey(last), 6)));
};

// Номер пары для студента — порядковый в его дне: если день начинается в 13:45, это «1 пара».
export const ordinalIn = (dayLessons: Lesson[], lesson: Lesson) => {
  const slots = [...new Set(dayLessons.map((item) => item.lessonNumber))].sort((a, b) => a - b);
  return slots.indexOf(lesson.lessonNumber) + 1;
};
