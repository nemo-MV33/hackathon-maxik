import type { Plugin } from 'vite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const monday = (offsetWeeks = 0) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offsetWeeks * 7);
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
    date.setUTCDate(start.getUTCDate() + day);
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
    examDay.setUTCDate(start.getUTCDate() + 2);
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
    const { universities } = await backend('../src/universities/config.js');
    const { parseSchedule } = await backend('../src/universities/bgu/parser.js');
    const { lessonMoments, universityTimeZone, zonedDateKey } = await backend('../src/lib/timezone.js');
    const bguSaved = JSON.parse(await readFile(new URL('../src/universities/bgu/saved/32982.json', import.meta.url), 'utf8'));
    const bguHtml = await readFile(new URL('../test/fixtures/bgu/gmu-25-1-working.html', import.meta.url), 'utf8');
    const sources = JSON.parse(await readFile(new URL('../test/fixtures/bgu/sources.json', import.meta.url), 'utf8'));
    const bguSources: Record<string, { html: string; updatedAt: string }> = {
      'bgu~32982': { html: bguHtml, updatedAt: new Date(bguSaved.savedAt).toISOString() },
    };
    for (const [id, name] of [['bgu~33340', 'telek-bi-26-1.html'], ['bgu~32143', 'telek-znb-23-1.html']]) {
      bguSources[id] = { html: await readFile(new URL(`../test/fixtures/bgu/${name}`, import.meta.url), 'utf8'), updatedAt: sources[name].savedAt };
    }
    const { AttachmentStore } = await backend('../src/storage/attachments.js');
    const { CommunityStore } = await backend('../src/storage/community.js');
    const { PreferencesStore } = await backend('../src/storage/preferences.js');
    const { LessonChangeService } = await backend('../src/services/lesson-change-service.js');
    const { createHttpServer } = await backend('../src/http/server.js');
    const directory = await mkdtemp(join(tmpdir(), 'norfly-demo-'));
    server.httpServer?.once('close', () => { void rm(directory, { recursive: true, force: true }); });
    const community = new CommunityStore(join(directory, 'community.json'));
    const preferences = new PreferencesStore(join(directory, 'preferences.json'));
    community.attachmentStore = new AttachmentStore(join(directory, 'files'), { community, preferences, secret: 'local-demo' });
    // СПбПУ и СПбГУ в демо работают на ответах их API, сохранённых в test/fixtures.
    const { SpbpuProvider } = await backend('../src/universities/spbpu/provider.js');
    const { SpbuProvider } = await backend('../src/universities/spbu/provider.js');
    const fixtureFetcher = (folder: string, routes: Record<string, string>) => async (url: URL) => {
      const path = decodeURIComponent(new URL(url).pathname).replace(/^\/api\/v1\/(ruz\/)?/, '');
      const name = Object.entries(routes).find(([prefix]) => path.startsWith(prefix))?.[1];
      const body = name ? JSON.parse(await readFile(new URL(`../test/fixtures/${folder}/${name}`, import.meta.url), 'utf8')) : {};
      return { ok: Boolean(name), status: name ? 200 : 404, headers: new Headers(), json: async () => body };
    };
    const spb = {
      spbpu: new SpbpuProvider({ cacheDir: join(directory, 'spbpu'), fetcher: fixtureFetcher('spbpu', {
        'faculties/125/groups': 'groups-125.json', 'faculties': 'faculties.json', 'scheduler/45680': 'scheduler-45680-2026-10-19.json' }) }),
      spbu: new SpbuProvider({ cacheDir: join(directory, 'spbu'), fetcher: fixtureFetcher('spbu', {
        'study/divisions/PHYS': 'levels-phys.json', 'study/divisions': 'divisions.json', 'programs/18250/groups': 'program-18250-groups.json',
        'groups/474610/events': 'group-474610-2026-10-19.json' }) }),
    } as Record<string, { groupSchedule: (id: number, options: object) => Promise<{ lessons: object[]; weekEven: boolean | null; updatedAt: string }>; browse?: (path: string) => Promise<{ id: string | number; kind: string }[]> }>;
    const groups = [
      { id: 'irnitu~1', universityId: 'irnitu', title: 'ДЕМО-25-1', institute: 'Демо-институт', course: 1 },
      { id: 'spbpu~45680', universityId: 'spbpu', title: '5130903/30301', institute: 'Институт компьютерных наук и кибербезопасности', course: 4 },
      { id: 'spbu~474610', universityId: 'spbu', title: '25.Б20-фз', institute: 'Физика', course: 2 },
      { id: 'irnitu~2', universityId: 'irnitu', title: 'ДЕМО-24-2', institute: 'Демо-институт', course: 2 },
      { id: 'bgu~32982', universityId: 'bgu', title: 'ГМУ-25-1', institute: '', course: null },
      { id: 'bgu~33340', universityId: 'bgu', title: 'БИ-26-1', institute: '', course: null },
      { id: 'bgu~32143', universityId: 'bgu', title: 'ЗНБ-23-1', institute: '', course: null },
    ];
    const group = { ...groups[0], kind: 'group' };
    await community.setChat(-1, { group, headman: { userId: 1, name: 'Тест' }, editors: [{ userId: 3, name: 'Редактор' }], lang: 'ru' });
    const bguGroup = { ...groups[2], kind: 'group' };
    await community.setChat(-2, { group: bguGroup, headman: { userId: 4, name: 'Староста БГУ' }, lang: 'ru' });
    for (const id of [4, 5]) await preferences.set(id, { selection: bguGroup, subgroup: null, lang: 'ru', timeZone: 'Europe/Moscow', onboarded: true });
    for (const id of [1, 2, 3]) await preferences.set(id, { selection: group, subgroup: 1, lang: 'ru', onboarded: false });
    const weeks = [week(0), week(1)];
    const updatedAt = new Date().toISOString();
    const notifications: { chatId?: number; userId?: number; text: string }[] = [];
    let lessonChanges: InstanceType<typeof LessonChangeService>;
    const service = {
      universities: () => universities,
      groups: async (universityId = 'irnitu') => groups.filter((group) => group.universityId === universityId),
      teachers: async () => [], auditories: async () => [],
      searchTeachers: async () => [], searchAuditories: async () => [],
      institutes: async () => ['Демо-институт'],
      browse: async (universityId: string, path = '') => (await spb[universityId].browse!(path))
        .map((item) => (item.kind === 'group' ? { ...item, id: `${universityId}~${item.id}`, universityId } : item)),
      hasGroup: async (id: string) => groups.some((group) => group.id === id),
      searchGroups: async (query: string, { universityId = 'irnitu' } = {}) => groups.filter((group) => group.universityId === universityId && (!query || group.title.toLowerCase().includes(query.toLowerCase()))),
      groupSchedule: async (id: string | number, { week: requested = new Date(), subgroup = null, raw = false } = {}) => {
        const start = new Date(requested);
        start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
        const key = dateKey(start);
        const value = weeks.find((item) => item.weekStart === key);
        const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
        const [prefix, sourceId] = String(id).split('~');
        if (spb[prefix]) {
          const week = await spb[prefix].groupSchedule(Number(sourceId), { week: start });
          let spbLessons = week.lessons as { date: string }[];
          if (!raw) spbLessons = await lessonChanges.overlay(id, spbLessons, key, dateKey(end));
          return { kind: 'group', entityId: id, period: { from: start, to: end }, weekEven: week.weekEven, updatedAt: week.updatedAt,
            lessons: spbLessons.map((item) => ({ ...lessonMoments(item, 'Europe/Moscow'), groupId: id, updatedAt: week.updatedAt })) };
        }
        const source = bguSources[String(id)];
        const bgu = source ? parseSchedule(source.html, { week: start, groupId: Number(String(id).split('~')[1]) }) : null;
        const sourceUpdatedAt = source?.updatedAt ?? updatedAt;
        let lessons = bgu?.lessons ?? value?.lessons ?? [];
        if (!raw) lessons = await lessonChanges.overlay(id, lessons, key, dateKey(end));
        return { kind: 'group', entityId: id, period: { from: start, to: end }, weekEven: bgu?.weekEven ?? value?.weekEven ?? false,
          updatedAt: sourceUpdatedAt, lessons: lessons.filter((item: { subgroup: number | null }) => !subgroup || !item.subgroup || item.subgroup === subgroup)
            .map((item: object) => ({ ...lessonMoments(item), groupId: id, updatedAt: sourceUpdatedAt })) };
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
      const prefs = await preferences.get(input.user.user_id);
      const groupId = prefs.selection?.kind === 'group' ? prefs.selection.id : null;
      if (!groupId) return { status: 'no_group' };
      const chat = (await community.chatsForGroup(groupId))[0];
      if (!chat?.headman) return { status: 'no_headman' };
      await community.addNotice({ groupId, chatId: chat.chatId, date: input.lesson?.date ?? zonedDateKey(new Date(), universityTimeZone(groupId)),
        senderId: input.user.user_id, senderName: input.user.first_name ?? 'Тест', kind: input.kind,
        reasonCode: input.reasonCode, text: input.text, minutes: input.minutes, lesson: input.lesson ?? null });
      return { status: 'sent' };
    };
    const publishAnnouncement = async (item: { chatId: number; text: string }) => {
      notifications.push({ chatId: item.chatId, text: item.text });
      return { chat: true };
    };
    const demoFiles = [];
    for (const [path, name] of [['board.jpg', 'Фото доски.jpg'], ['method.pdf', 'Методичка.pdf']]) {
      demoFiles.push(await community.attachmentStore.upload(await readFile(new URL(`../test/fixtures/attachments/${path}`, import.meta.url)), {
        userId: 1, groupId: group.id, scope: 'shared', name,
      }));
    }
    const demoLesson = weeks[1].lessons[0];
    await community.upsertHomework({ groupId: group.id, groupTitle: group.title, lessonDate: demoLesson.date,
      lessonNumber: demoLesson.lessonNumber, lessonTime: demoLesson.time, subgroup: demoLesson.subgroup ?? null,
      subject: demoLesson.subject, text: 'Найдите производные функций 1–5. Фото доски и методичка приложены.',
      attachments: demoFiles, authorId: 1, authorName: 'Староста' });
    const onHomeworkSaved = (item: { subject: string; version: number; attachments?: unknown[] }) => {
      notifications.push({ chatId: -1, text: `${item.subject}: версия ${item.version}, вложений ${item.attachments?.length ?? 0}` });
    };
    const options = { service, community, preferences, lessonChanges, sendAbsence, publishAnnouncement, onHomeworkSaved };
    const api = createHttpServer({ ...options, devUserId: 1, devUserName: 'Староста' });
    const apiStudent = createHttpServer({ ...options, devUserId: 2, devUserName: 'Студент' });
    const apiEditor = createHttpServer({ ...options, devUserId: 3 });
    const apiBguHeadman = createHttpServer({ ...options, devUserId: 4 });
    const apiBguStudent = createHttpServer({ ...options, devUserId: 5 });
    const apiNewUser = createHttpServer({ ...options, devUserId: 6 });
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const send = (value: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
      if (url.pathname === '/api/demo/notifications') return send({ items: notifications });
      if (url.pathname.startsWith('/api/')) {
        const selected = ({ '1': api, '2': apiStudent, '3': apiEditor, '4': apiBguHeadman, '5': apiBguStudent, '6': apiNewUser } as Record<string, typeof api>)[String(request.headers['x-demo-user'] ?? '1')] ?? api;
        selected.emit('request', request, response);
        return;
      }
      if (url.pathname === '/data/groups.json') return send(groups);
      if (url.pathname === '/data/meta.json') return send({ updatedAt, weeks: weeks.map((item) => item.weekStart), groups: groups.length, failed: 0 });
      const match = url.pathname.match(/^\/data\/schedule\/((?:irnitu|bgu|spbpu|spbu)~\d+)\/(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) {
        if (!groups.some((group) => group.id === match[1])) { response.statusCode = 404; response.end(); return; }
        void service.groupSchedule(match[1], { week: new Date(`${match[2]}T00:00:00Z`) }).then((value) => send({ ...value, weekStart: match[2] }))
          .catch(() => { response.statusCode = 503; send({ error: 'schedule_unavailable' }); });
        return;
      }
      next();
    });
  },
});
