import type { Plugin } from 'vite';

const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monday = (offsetWeeks = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offsetWeeks * 7);
  return date;
};

const TIMES = ['08:15–09:45', '10:00–11:30', '11:45–13:15', '13:45–15:15', '15:30–17:00', '17:10–18:40'];
const SUBJECTS = [
  ['Математический анализ', 'лекция', 'Иванова А. П.', 'Ж-301'],
  ['Программирование', 'лабораторная', 'Петров С. В.', 'В-204'],
  ['Физика', 'практика', 'Сидоров К. Л.', 'Ж-115'],
  ['Английский язык', 'практика', 'Смирнова Е. И.', 'Е-412'],
];

const week = (offset: number) => {
  const start = monday(offset);
  const lessons = [];
  for (let day = 0; day < 6; day += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    for (let slot = 0; slot < 3 + (day % 2); slot += 1) {
      const [subject, lessonType, teacher, auditory] = SUBJECTS[(day + slot) % SUBJECTS.length];
      lessons.push({
        date: dateKey(date), lessonNumber: slot + 1, time: TIMES[slot], subject, lessonType,
        subgroup: lessonType === 'лабораторная' ? (slot % 2) + 1 : null,
        teachers: [teacher], auditories: [auditory],
      });
    }
  }
  return { weekStart: dateKey(start), weekEven: offset % 2 === 0, lessons };
};

export const devData = (): Plugin => ({
  name: 'norfly-dev-data',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const match = request.url?.match(/\/data\/(groups|meta)\.json$|\/data\/schedule\/\d+\/(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) return next();
      const weeks = [dateKey(monday(0)), dateKey(monday(1))];
      let body: unknown;
      if (match[1] === 'groups') {
        body = [
          { id: 1, title: 'ДЕМО-25-1', institute: 'Демо-институт', course: 1 },
          { id: 2, title: 'ДЕМО-24-2', institute: 'Демо-институт', course: 2 },
        ];
      } else if (match[1] === 'meta') {
        body = { updatedAt: new Date().toISOString(), weeks, groups: 2, failed: 0 };
      } else {
        const offset = weeks.indexOf(match[2]);
        if (offset < 0) { response.statusCode = 404; return response.end(); }
        body = week(offset);
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
    });
  },
});
