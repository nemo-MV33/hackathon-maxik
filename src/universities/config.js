import { bguLessonTimes } from './bgu/parser.js';
import { lessonTimes } from './irnitu/normalize.js';
import { spbpuLessonTimes } from './spbpu/provider.js';
import { spbuLessonTimes } from './spbu/provider.js';

// Подключённые вузы. Новый вуз — это провайдер с общим контрактом и запись здесь:
// источник, способ доступа, часовой пояс, сетка звонков и поддерживаемые справочники.
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
  { id: 'spbpu', name: { ru: 'СПбПУ', en: 'SPbPU' },
    fullName: { ru: 'Санкт-Петербургский политехнический университет Петра Великого', en: 'Peter the Great St. Petersburg Polytechnic University' },
    city: { ru: 'Санкт-Петербург', en: 'Saint Petersburg' }, timeZone: 'Europe/Moscow', lessonTimes: spbpuLessonTimes,
    parityRule: 'source.week_is_odd', source: 'https://ruz.spbstu.ru/api/v1/ruz/', access: 'public_api',
    capabilities: { groups: true, institutes: true, teachers: true, auditories: true, exams: true, controls: false } },
  { id: 'spbu', name: { ru: 'СПбГУ', en: 'SPbU' },
    fullName: { ru: 'Санкт-Петербургский государственный университет', en: 'Saint Petersburg State University' },
    city: { ru: 'Санкт-Петербург', en: 'Saint Petersburg' }, timeZone: 'Europe/Moscow', lessonTimes: spbuLessonTimes,
    parityRule: 'source.dated_events', source: 'https://timetable.spbu.ru/api/v1/', access: 'public_api_daily_quota',
    // Группа выбирается через каталог вуза: поиска по названию в API нет.
    capabilities: { groups: true, catalog: true, institutes: false, teachers: true, auditories: false, exams: true, controls: false } },
];
export const UNIVERSITY_IDS = universities.map((item) => item.id);
export const university = (id = 'irnitu') => {
  const value = universities.find((item) => item.id === id);
  if (!value) throw new Error('unknown_university');
  return value;
};
