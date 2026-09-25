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
    const homework = new Map<string, {
      sharedText: string | null;
      personalText: string | null;
      subject: string;
      time: string;
      version: number;
    }>();
    const send = (response: import('node:http').ServerResponse, body: unknown, status = 200) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
    };
    const readBody = async (request: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    };
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/me') {
        if (request.method === 'PUT') await readBody(request);
        return send(response, {
          user: { id: 1, firstName: 'Тест' },
          profile: { group: { id: 1, title: 'ДЕМО-25-1' }, institute: 'Демо-институт', course: 1, subgroup: 1 },
        });
      }
      if (url.pathname !== '/api/homework') return next();
      if (request.method === 'PUT') {
        const body = await readBody(request);
        const key = `${body.date}:${body.lessonNumber}:${body.subgroup ?? 0}`;
        const lessons = [...week(0).lessons, ...week(1).lessons];
        const lesson = lessons.find((item) => `${item.date}:${item.lessonNumber}:${item.subgroup ?? 0}` === key);
        if (!lesson) return send(response, { error: 'lesson_not_found', message: 'Пара не найдена' }, 404);
        const current = homework.get(key) ?? {
          sharedText: null, personalText: null, subject: lesson.subject, time: lesson.time, version: 0,
        };
        if (body.scope === 'shared') {
          current.sharedText = body.text;
          if (body.text) current.version += 1;
        } else current.personalText = body.text;
        homework.set(key, current);
        return send(response, { item: current });
      }
      const from = url.searchParams.get('from') ?? '0000-00-00';
      const to = url.searchParams.get('to') ?? '9999-99-99';
      const items = [...homework.entries()].map(([key, item]) => {
        const [date, lessonNumber, subgroup] = key.split(':');
        return {
          groupId: 1, date, lessonNumber: Number(lessonNumber), subgroup: Number(subgroup) || null,
          subject: item.subject, lessonTime: item.time, sharedText: item.sharedText,
          personalText: item.personalText, text: item.personalText ?? item.sharedText ?? '',
          source: item.personalText ? 'personal' : 'shared', updatedAt: new Date().toISOString(),
          authorName: item.sharedText ? 'Староста' : null, version: item.version,
        };
      }).filter((item) => item.date >= from && item.date <= to && item.text);
      return send(response, {
        group: { id: 1, title: 'ДЕМО-25-1' }, role: 'headman', canEditShared: true,
        period: { from, to }, items,
      });
    });
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
