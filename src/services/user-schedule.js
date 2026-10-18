import { addDays, startOfWeek, toDateKey } from '../lib/date.js';
import { universityTimeZone, lessonInTimeZone, zonedDateKey, zonedMoment } from '../lib/timezone.js';

// Дата интерфейса относится к пользователю; запросы и ключи пар — к вузу.
export const userDayLessons = async (service, groupId, day, timeZone, subgroup, lastDay = day) => {
  const from = zonedMoment(day, '00:00', timeZone);
  const nextDay = toDateKey(addDays(new Date(`${lastDay}T00:00:00Z`), 1));
  const to = new Date(zonedMoment(nextDay, '00:00', timeZone) - 1);
  const weeks = [...new Set([from, to].map((instant) => toDateKey(startOfWeek(new Date(`${zonedDateKey(instant, universityTimeZone(groupId))}T00:00:00Z`)))))];
  const responses = await Promise.all(weeks.map((week) => service.groupSchedule(groupId, { week: new Date(`${week}T00:00:00Z`), subgroup })));
  const unique = new Map(responses.flatMap((response) => response.lessons)
    .filter((lesson) => { const date = lessonInTimeZone(lesson, timeZone).date; return date >= day && date <= lastDay; })
    .map((lesson) => [`${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`, lesson]));
  return [...unique.values()].sort((a, b) => (a.startsAt ?? `${a.date}T${a.time}`).localeCompare(b.startsAt ?? `${b.date}T${b.time}`));
};
