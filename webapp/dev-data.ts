import type { Plugin } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  if (offset === 1) {
    const examDay = new Date(start);
    examDay.setDate(start.getDate() + 2);
    lessons.push({
      date: dateKey(examDay), lessonNumber: 5, time: TIMES[4], subject: 'Математический анализ', lessonType: 'экзамен',
      subgroup: null, teachers: ['Иванова А. П.'], auditories: ['Ж-301'],
    });
  }
  return { weekStart: dateKey(start), weekEven: offset % 2 === 0, lessons };
};

export const devData = (): Plugin => ({
  name: 'norfly-dev-data',
  apply: 'serve',
  async configureServer(server) {
    // Демо использует те же маршруты и переносы, что бот и продакшен.
    const backend = (path: string) => import(/* @vite-ignore */ new URL(path, import.meta.url).href);
    const { CommunityStore } = await backend('../src/storage/community.js');
    const { PreferencesStore } = await backend('../src/storage/preferences.js');
    const { LessonChangeService } = await backend('../src/services/lesson-change-service.js');
    const { createHttpServer } = await backend('../src/http/server.js');
    const directory = await mkdtemp(join(tmpdir(), 'norfly-demo-'));
    server.httpServer?.once('close', () => { void rm(directory, { recursive: true, force: true }); });
    const community = new CommunityStore(join(directory, 'community.json'));
    const preferences = new PreferencesStore(join(directory, 'preferences.json'));
    const groups = [
      { id: 1, title: 'ДЕМО-25-1', institute: 'Демо-институт', course: 1 },
      { id: 2, title: 'ДЕМО-24-2', institute: 'Демо-институт', course: 2 },
    ];
    const group = { ...groups[0], kind: 'group' };
    await community.setChat(-1, { group, headman: { userId: 1, name: 'Тест' }, editors: [{ userId: 3, name: 'Редактор' }], lang: 'ru' });
    for (const id of [1, 2, 3]) await preferences.set(id, { selection: group, subgroup: 1, lang: 'ru', onboarded: false });
    const weeks = [week(0), week(1)];
    const updatedAt = new Date().toISOString();
    const notifications: { chatId?: number; userId?: number; text: string }[] = [];
    let lessonChanges: InstanceType<typeof LessonChangeService>;
    const service = {
      groups: async () => groups,
      institutes: async () => ['Демо-институт'],
      searchGroups: async () => groups,
      groupSchedule: async (id: number, { week: requested = new Date(), subgroup = null, raw = false } = {}) => {
        const start = new Date(requested);
        start.setDate(start.getDate() - (start.getDay() + 6) % 7);
        const key = dateKey(start);
        const value = weeks.find((item) => item.weekStart === key);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        let lessons = value?.lessons ?? [];
        if (!raw) lessons = await lessonChanges.overlay(id, lessons, key, dateKey(end));
        return { kind: 'group', entityId: id, period: { from: start, to: end }, weekEven: value?.weekEven ?? false,
          updatedAt, lessons: lessons.filter((item: { subgroup: number | null }) => !subgroup || !item.subgroup || item.subgroup === subgroup)
            .map((item: object) => ({ ...item, updatedAt })) };
      },
    };
    lessonChanges = new LessonChangeService({ community, preferences, service, bot: { api: {
      sendMessageToChat: async (chatId: number, text: string) => { notifications.push({ chatId, text }); },
      sendMessageToUser: async (userId: number, text: string) => { notifications.push({ userId, text }); },
    } } });
    const sendAbsence = async (input: {
      user: { user_id: number; first_name?: string }; kind: string; reasonCode: string | null;
      text: string | null; minutes: number | null; lesson?: { date: string; lessonNumber: number; subject: string; time: string };
    }) => {
      await community.addNotice({ groupId: 1, chatId: -1, date: input.lesson?.date ?? dateKey(new Date()),
        senderId: input.user.user_id, senderName: input.user.first_name ?? 'Тест', kind: input.kind,
        reasonCode: input.reasonCode, text: input.text, minutes: input.minutes, lesson: input.lesson ?? null });
      return { status: 'sent' };
    };
    const publishAnnouncement = async (item: { chatId: number; text: string }) => {
      notifications.push({ chatId: item.chatId, text: item.text });
      return { chat: true };
    };
    const options = { service, community, preferences, lessonChanges, sendAbsence, publishAnnouncement };
    const api = createHttpServer({ ...options, devUserId: 1 });
    const apiStudent = createHttpServer({ ...options, devUserId: 2 });
    const apiEditor = createHttpServer({ ...options, devUserId: 3 });
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const send = (value: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
      if (url.pathname === '/api/demo/notifications') return send({ items: notifications });
      if (url.pathname.startsWith('/api/')) {
        const selected = request.headers['x-demo-user'] === '2' ? apiStudent : request.headers['x-demo-user'] === '3' ? apiEditor : api;
        selected.emit('request', request, response);
        return;
      }
      if (url.pathname === '/data/groups.json') return send(groups);
      if (url.pathname === '/data/meta.json') return send({ updatedAt, weeks: weeks.map((item) => item.weekStart), groups: 2, failed: 0 });
      const match = url.pathname.match(/^\/data\/schedule\/\d+\/(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) {
        const value = weeks.find((item) => item.weekStart === match[1]);
        if (!value) { response.statusCode = 404; response.end(); return; }
        return send({ ...value, updatedAt });
      }
      next();
    });
  },
});
