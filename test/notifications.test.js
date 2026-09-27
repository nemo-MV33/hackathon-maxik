import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from '../src/http/server.js';
import { irkutskDateKey } from '../src/lib/irkutsk.js';
import { NotificationService, diffSchedules } from '../src/services/notification-service.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';

const GROUP = { kind: 'group', id: 11, title: 'ИСТб-25-1' };
const at = (hour, minute = 0) => new Date(Date.UTC(2026, 9, 1, hour - 8, minute));
const NOW = at(20, 5);
const TODAY = irkutskDateKey(NOW);
const TOMORROW = irkutskDateKey(NOW, 1);

const lesson = (date, lessonNumber, extra = {}) => ({
  date, lessonNumber, time: ['', '08:15–09:45', '10:00–11:30', '11:45–13:15'][lessonNumber],
  subject: 'Математический анализ', lessonType: 'лекция', subgroup: null,
  teachers: ['Иванова А. П.'], auditories: ['Ж-301'], ...extra,
});

const setup = async (t, lessons) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-notify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const community = new CommunityStore(join(directory, 'community.json'));
  const sent = [];
  const state = { lessons };
  const bot = {
    api: { sendMessageToUser: async (userId, text, extra) => { sent.push({ userId, text, extra }); } },
    appButton: (t, payload, text) => ({ type: 'open_app', text, payload }),
  };
  const service = {
    groupSchedule: async (id, { subgroup } = {}) => ({
      lessons: state.lessons.filter((item) => !subgroup || !item.subgroup || item.subgroup === subgroup),
    }),
  };
  const notifications = new NotificationService({
    bot, service, preferences, community, now: () => NOW,
    snapshotsPath: join(directory, 'snapshots.json'), homeworkDelayMs: 0,
  });
  const user = (id, patch = {}) => preferences.set(id, { lang: 'ru', selection: GROUP, subgroup: null, ...patch });
  return { notifications, preferences, community, sent, state, user };
};

const buttonPayload = (message) => message.extra.attachments[0].payload.buttons[0][0].payload;

test('новое ДЗ приходит группе, кроме автора, отключивших и другой подгруппы', async (t) => {
  const { notifications, sent, user } = await setup(t, []);
  await user(1);
  await user(2);
  await user(3, { notifications: { homework: false } });
  await user(4, { subgroup: 2 });
  await user(5, { selection: { kind: 'group', id: 99, title: 'Другая' } });

  const count = await notifications.notifyHomework({
    groupId: 11, lessonDate: TOMORROW, lessonNumber: 2, lessonTime: '10:00–11:30', subgroup: 1,
    subject: 'Физика', text: 'Задачи 1–5', authorId: 2, version: 1,
  });
  assert.equal(count, 1);
  assert.deepEqual(sent.map((item) => item.userId), [1]);
  assert.match(sent[0].text, /Новое ДЗ.*Физика/);
  assert.match(sent[0].text, /Задачи 1–5/);
  assert.equal(buttonPayload(sent[0]), `lesson_${TOMORROW}_2_1`);

  await notifications.notifyHomework({ groupId: 11, lessonDate: TOMORROW, lessonNumber: 2, subject: 'Физика', text: 'Задачи 1–6', authorId: 2 }, { isUpdate: true });
  assert.match(sent.at(-1).text, /ДЗ изменено/);
});

test('сводка на завтра уходит один раз после 20:00', async (t) => {
  const { notifications, sent, user, community, preferences } = await setup(t, [
    lesson(TOMORROW, 1), lesson(TOMORROW, 2, { subject: 'Физика' }), lesson(TOMORROW, 3, { subgroup: 2, subject: 'Английский' }),
  ]);
  await user(1, { subgroup: 1 });
  await user(2, { notifications: { summary: false } });
  await community.upsertHomework({
    groupId: 11, lessonDate: TOMORROW, lessonNumber: 2, lessonTime: '10:00–11:30', subgroup: null, subject: 'Физика', text: 'Задачи',
  });

  assert.equal(await notifications.sendSummaries(), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, 1);
  assert.match(sent[0].text, /Завтра/);
  assert.match(sent[0].text, /2 пары, первая в 08:15/);
  assert.match(sent[0].text, /ДЗ задано к 1 из 2/);
  assert.match(sent[0].text, /· Физика/);
  assert.equal(buttonPayload(sent[0]), `day_${TOMORROW}`);
  assert.equal((await preferences.get(1)).summarySentFor, TOMORROW);

  assert.equal(await notifications.sendSummaries(), 0, 'повторно не отправляется');
  notifications.now = () => at(19, 30);
  await user(3);
  assert.equal(await notifications.sendSummaries(), 0, 'до 20:00 не отправляется');
});

test('переносы и замены: первый снимок молча, дальше — изменения по подгруппе', async (t) => {
  const { notifications, sent, user, state } = await setup(t, [
    lesson(TODAY, 1), lesson(TOMORROW, 2, { subject: 'Физика', auditories: ['Ж-115'] }),
    lesson(TOMORROW, 3, { subject: 'Английский', subgroup: 2 }),
  ]);
  await user(1, { subgroup: 1 });
  await user(2, { subgroup: 2 });
  await user(3, { notifications: { changes: false } });

  assert.equal(await notifications.checkChanges(), 0);
  assert.equal(sent.length, 0);

  state.lessons = [
    lesson(TODAY, 1),
    lesson(TOMORROW, 2, { subject: 'Физика', auditories: ['В-208'] }),
  ];
  assert.equal(await notifications.checkChanges(), 2);
  const first = sent.find((item) => item.userId === 1);
  const second = sent.find((item) => item.userId === 2);
  assert.match(first.text, /Изменения в расписании\*\* · ИСТб-25-1/);
  assert.match(first.text, /аудитория Ж-115 → В-208/);
  assert.doesNotMatch(first.text, /Английский/, 'чужая подгруппа не приходит');
  assert.match(second.text, /Английский — отменена/);
  assert.ok(!sent.some((item) => item.userId === 3));

  sent.length = 0;
  assert.equal(await notifications.checkChanges(), 0, 'без изменений тишина');
});

test('diffSchedules находит отмену, новую пару, аудиторию, преподавателя и замену предмета', () => {
  const before = [
    lesson('2026-10-02', 1), lesson('2026-10-02', 2), lesson('2026-10-02', 3), lesson('2026-10-03', 1),
  ];
  const after = [
    lesson('2026-10-02', 1, { auditories: ['В-208'], teachers: ['Петров С. В.'] }),
    lesson('2026-10-02', 3, { subject: 'Физика' }),
    lesson('2026-10-03', 1), lesson('2026-10-03', 2),
    lesson('2026-10-20', 1),
  ];
  const types = diffSchedules(before, after, { from: '2026-10-01', to: '2026-10-07' }).map((change) => change.type);
  assert.deepEqual(types.sort(), ['added', 'cancelled', 'room', 'subject', 'teacher']);
});

const BOT_TOKEN = 'test-bot-token';
const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

test('POST /api/absence и настройки уведомлений в /api/me', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-absence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const calls = [];
  const sendAbsence = async (input) => { calls.push(input); return { status: 'sent' }; };
  const service = {
    groups: async () => [{ id: 11, title: 'ИСТб-25-1', institute: 'ИИТ', course: 1 }],
    groupSchedule: async () => ({ lessons: [lesson('2026-10-02', 2, { subject: 'Физика' })] }),
  };
  const server = createHttpServer({ service, preferences, botToken: BOT_TOKEN, sendAbsence });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const user = { id: 7, first_name: 'Аня', last_name: 'Петрова', username: 'anya' };
  const call = (path, method, body) => fetch(`http://localhost:${server.address().port}${path}`, {
    method, headers: { Authorization: `tma ${initDataFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  assert.equal((await call('/api/absence', 'POST', { kind: 'late', reason: 'transport' })).status, 409, 'без группы');
  await preferences.set(7, { selection: GROUP, subgroup: null });

  assert.equal((await call('/api/absence', 'POST', { kind: 'soon' })).status, 400);
  assert.equal((await call('/api/absence', 'POST', { kind: 'late', reason: 'ill' })).status, 400, 'причина не подходит к опозданию');
  assert.equal((await call('/api/absence', 'POST', { kind: 'absent' })).status, 400, 'нужна причина');
  assert.equal((await call('/api/absence', 'POST', { kind: 'late', reason: 'late10', lessonDate: '2026-10-02', lessonNumber: 5 })).status, 404);

  const ok = await call('/api/absence', 'POST', { kind: 'late', reason: 'late10', lessonDate: '2026-10-02', lessonNumber: 2 });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'sent' });
  assert.equal(calls[0].user.first_name, 'Аня');
  assert.equal(calls[0].lesson.subject, 'Физика');
  assert.equal(calls[0].reasonCode, 'late10');

  const own = await call('/api/absence', 'POST', { kind: 'absent', text: '  Температура  ' });
  assert.equal(own.status, 200);
  assert.equal(calls[1].text, 'Температура');
  assert.equal(calls[1].lesson, undefined, 'пару определит бот');

  const me = await (await call('/api/me', 'GET')).json();
  assert.deepEqual(me.profile.notifications, { summary: true, homework: true, changes: true });
  const updated = await (await call('/api/me', 'PUT', { notifications: { changes: false } })).json();
  assert.deepEqual(updated.profile.notifications, { summary: true, homework: true, changes: false });
  assert.equal((await preferences.get(7)).notifications.changes, false);
  assert.equal((await call('/api/me', 'PUT', { notifications: { spam: true } })).status, 400);
});
