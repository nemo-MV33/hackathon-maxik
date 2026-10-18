import { bguLessonTimes } from './bgu/parser.js';
import { lessonTimes } from './irnitu/normalize.js';

export const universities = [
  { id: 'irnitu', name: { ru: 'ИРНИТУ', en: 'IRNITU' },
    fullName: { ru: 'Иркутский национальный исследовательский технический университет', en: 'Irkutsk National Research Technical University' },
    city: { ru: 'Иркутск', en: 'Irkutsk' }, timeZone: 'Asia/Irkutsk', lessonTimes,
    parityRule: 'source.week_even', source: 'https://schedule.istu.edu/api/', access: 'official_api_token',
    capabilities: { groups: true, institutes: true, teachers: true, auditories: true, exams: true, controls: false } },
  { id: 'bgu', name: { ru: 'БГУ', en: 'BSU' },
    fullName: { ru: 'Байкальский государственный университет', en: 'Baikal State University' },
    city: { ru: 'Иркутск', en: 'Irkutsk' }, timeZone: 'Asia/Irkutsk', lessonTimes: bguLessonTimes,
    parityRule: 'source.current_date_and_parity', source: 'https://bgu.ru/student/timetable.aspx', access: 'public_website',
    scheduleSource: 'https://bgu.ru/telek/timetable.aspx', teacherSource: 'https://bgu.ru/telek/timetable-pps.aspx',
    capabilities: { groups: true, institutes: false, teachers: true, auditories: false, exams: true, controls: false } },
];
export const university = (id = 'irnitu') => {
  const value = universities.find((item) => item.id === id);
  if (!value) throw new Error('unknown_university');
  return value;
};
