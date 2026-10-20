import { lessonDate } from './timezone';
import { loadMeta, loadWeek, type Lesson } from '../data/schedule';
import { addDays, fromDateKey, startOfWeek, toDateKey } from './date';

export const forSubgroup = (lessons: Lesson[], subgroup: 1 | 2 | null) =>
  lessons.filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup);

const byTime = (left: Lesson, right: Lesson) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`);

// Пары за период из уже выгруженных недель. Недели, которых нет в выгрузке, просто пропускаем.
// Для семестра одна неудачная неделя не должна обнулять весь список: ошибка — только если не пришло ничего.
export const loadLessons = async (groupId: string | number, subgroup: 1 | 2 | null, fromKey: string, toKey: string, { partial = false } = {}) => {
  const meta = await loadMeta();
  const firstWeek = toDateKey(startOfWeek(fromDateKey(fromKey)));
  const weeks = meta.weeks.filter((week) => week >= firstWeek && week <= toKey);
  const settled = await Promise.allSettled(weeks.map((week) => loadWeek(groupId, week)));
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed && (!partial || settled.every((result) => result.status === 'rejected'))) throw failed.reason;
  const loaded = settled.map((result) => (result.status === 'fulfilled' ? result.value : null));
  const lessons = loaded.flatMap((week) => (week ? forSubgroup(week.lessons, subgroup) : []))
    .filter((lesson) => lessonDate(lesson) >= fromKey && lessonDate(lesson) <= toKey)
    .sort(byTime);
  return [...new Map(lessons.map((lesson) => [`${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}:${lesson.subject}`, lesson])).values()];
};

export const loadSemesterLessons = async (groupId: string | number, subgroup: 1 | 2 | null) => {
  const meta = await loadMeta();
  const last = meta.weeks.at(-1);
  if (!last) return [];
  return loadLessons(groupId, subgroup, meta.weeks[0], toDateKey(addDays(fromDateKey(last), 6)), { partial: true });
};

// Номер пары для студента — порядковый в его дне: если день начинается в 13:45, это «1 пара».
export const ordinalIn = (dayLessons: Lesson[], lesson: Lesson) => {
  const slots = [...new Set([...dayLessons].sort((a, b) => a.time.localeCompare(b.time)).map((item) => item.lessonNumber))];
  return slots.indexOf(lesson.lessonNumber) + 1;
};
