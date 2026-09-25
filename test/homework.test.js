import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from '../src/http/server.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';

const BOT_TOKEN = 'test-bot-token';
const GROUP = { kind: 'group', id: 478237, title: 'ИСТб-25-1' };
const LESSON = {
  date: '2099-09-24', lessonNumber: 2, time: '10:00–11:30', subject: 'Тестирование',
  lessonType: 'практика', subgroup: null, teachers: [], auditories: [],
};

const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const checkString = [...params.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

const startServer = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-homework-'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const community = new CommunityStore(join(directory, 'community.json'));
  const service = { groupSchedule: async () => ({ lessons: [LESSON] }) };
  const server = createHttpServer({ service, preferences, community, botToken: BOT_TOKEN });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (user, method = 'GET', body) => fetch(
    `http://localhost:${server.address().port}/api/homework?groupId=${GROUP.id}&from=2099-09-24&to=2099-09-24`,
    {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${initDataFor(user)}` },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  return { preferences, community, request };
};

const payload = (text, scope) => ({
  date: LESSON.date,
  lessonNumber: LESSON.lessonNumber,
  subgroup: LESSON.subgroup,
  text,
  scope,
});

test('editor writes shared homework and student sees it through the API', async (t) => {
  const { preferences, community, request } = await startServer(t);
  const editor = { id: 42, first_name: 'Староста' };
  const student = { id: 7, first_name: 'Студент' };
  await preferences.set(editor.id, { selection: GROUP });
  await preferences.set(student.id, { selection: GROUP });
  await community.setChat(101, { group: GROUP, headman: { userId: editor.id, name: 'Староста' } });

  const saved = await request(editor, 'PUT', payload('Подготовить пример', 'shared'));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).item.version, 1);

  const list = await request(student);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.canEditShared, false);
  assert.equal(body.items[0].text, 'Подготовить пример');
});

test('student can override homework only for themselves', async (t) => {
  const { preferences, community, request } = await startServer(t);
  const editor = { id: 42, first_name: 'Староста' };
  const student = { id: 7, first_name: 'Студент' };
  await preferences.set(editor.id, { selection: GROUP });
  await preferences.set(student.id, { selection: GROUP });
  await community.setChat(101, { group: GROUP, headman: { userId: editor.id, name: 'Староста' } });
  await request(editor, 'PUT', payload('Общее ДЗ', 'shared'));

  assert.equal((await request(student, 'PUT', payload('Чужое общее ДЗ', 'shared'))).status, 403);
  assert.equal((await request(student, 'PUT', payload('Моё ДЗ', 'personal'))).status, 200);
  let body = await (await request(student)).json();
  assert.equal(body.items[0].sharedText, 'Общее ДЗ');
  assert.equal(body.items[0].personalText, 'Моё ДЗ');
  assert.equal(body.items[0].text, 'Моё ДЗ');

  assert.equal((await request(student, 'PUT', payload(null, 'personal'))).status, 200);
  body = await (await request(student)).json();
  assert.equal(body.items[0].text, 'Общее ДЗ');
});
