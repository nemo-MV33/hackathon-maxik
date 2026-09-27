import { useEffect, useState } from 'react';
import { loadMeta, loadWeek, type Lesson } from '../data/schedule';
import { addDays, fromDateKey, startOfWeek, toDateKey } from './date';
import { isControlLesson } from './lessonKind';

const isExamListed = (lesson: Lesson) => isControlLesson(lesson.lessonType) || lesson.lessonType.toLowerCase() === 'консультация';

const forSubgroup = (lessons: Lesson[], subgroup: 1 | 2 | null) =>
  lessons.filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup);

// Контрольные из уже выгруженных недель: ничего не запрашиваем у ИРНИТУ напрямую.
export const loadExams = async (groupId: number, subgroup: 1 | 2 | null, todayKey: string, horizonDays?: number) => {
  const meta = await loadMeta();
  const firstWeek = toDateKey(startOfWeek(fromDateKey(todayKey)));
  const lastDay = horizonDays ? toDateKey(addDays(fromDateKey(todayKey), horizonDays)) : '9999-12-31';
  const weeks = meta.weeks.filter((week) => week >= firstWeek && week <= lastDay);
  const loaded = await Promise.all(weeks.map((week) => loadWeek(groupId, week).catch(() => null)));
  return loaded.flatMap((week) => (week ? forSubgroup(week.lessons, subgroup) : []))
    .filter((lesson) => lesson.date >= todayKey && lesson.date <= lastDay && isExamListed(lesson))
    .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
};

export const useUpcomingExams = (groupId: number, subgroup: 1 | 2 | null, todayKey: string) => {
  const [exams, setExams] = useState<Lesson[]>([]);
  useEffect(() => {
    let active = true;
    loadExams(groupId, subgroup, todayKey, 21)
      .then((items) => active && setExams(items.filter((lesson) => isControlLesson(lesson.lessonType))))
      .catch(() => {});
    return () => { active = false; };
  }, [groupId, subgroup, todayKey]);
  return exams;
};

export const daysBetween = (fromKey: string, toKey: string) =>
  Math.round((fromDateKey(toKey).getTime() - fromDateKey(fromKey).getTime()) / 86_400_000);
