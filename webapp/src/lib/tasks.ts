import { dateInZone, clockInZone, lessonDate, lessonTime } from './timezone';
import type { Lesson } from '../data/schedule';
import { homeworkKey, type HomeworkItem } from '../data/homework';
import type { Announcement } from './api';
import { toLocalInput } from './date';
import type { Task } from '../components/TaskList';

// Объявление попадает в день, на который стоит напоминание, а без него — в день публикации.
export const announcementDay = (item: Announcement) => toLocalInput(item.myRemindAt ?? item.remindAt ?? item.createdAt).slice(0, 10);

export const buildTasks = (homework: HomeworkItem[], announcements: Announcement[], lessons: Lesson[], todayKey: string): Task[] => {
  const byKey = new Map(lessons.map((lesson) => [homeworkKey(lesson), lesson]));
  const items: Task[] = [
    ...homework.filter((item) => (item.text || item.attachments?.length)).map((item): Task => ({
      kind: 'homework', key: `hw:${homeworkKey(item)}`, date: item.dueAt ? dateInZone(new Date(item.dueAt)) : lessonDate(byKey.get(homeworkKey(item)) ?? lessonFromHomework(item)), time: item.dueAt ? clockInZone(new Date(item.dueAt)) : lessonTime(byKey.get(homeworkKey(item)) ?? lessonFromHomework(item)).slice(0, 5), item, lesson: byKey.get(homeworkKey(item)),
    })),
    ...announcements.filter((item) => announcementDay(item) >= todayKey).map((item): Task => ({
      kind: 'announcement', key: `an:${item.id}`, date: announcementDay(item), time: toLocalInput(item.myRemindAt ?? item.createdAt).slice(11, 16), item,
    })),
  ];
  return items.sort((left, right) => Number(left.kind === 'homework' && left.item.completed) - Number(right.kind === 'homework' && right.item.completed) || `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
};

// Если пары нет в загруженных неделях, открываем карточку по данным ДЗ.
export const lessonFromHomework = (item: HomeworkItem): Lesson => ({
  groupId: item.groupId, date: item.date, lessonNumber: item.lessonNumber, time: item.lessonTime, subject: item.subject,
  lessonType: '', subgroup: item.subgroup, teachers: [], auditories: [],
});
