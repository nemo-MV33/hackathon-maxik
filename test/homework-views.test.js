import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from '../src/http/server.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';

const BOT_TOKEN = 'test-bot-token';
const GROUP = { kind: 'group', id: 478237, title: 'ИСТб-25-1' };
const HEADMAN = { id: 3, first_name: 'Маша' };
const STUDENT = { id: 1, first_name: 'Аня' };
const OTHER = { id: 2, first_name: 'Иван' };
const LESSON = { groupId: GROUP.id, lessonDate: '2099-09-24', lessonNumber: 2, lessonTime: '10:00–11:30', subgroup: null, subject: 'Тестирование' };
const VIEW = { date: LESSON.lessonDate, lessonNumber: LESSON.lessonNumber, subgroup: null };

const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const checkString = [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

const setup = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-views-'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const community = new CommunityStore(join(directory, 'community.json'));
  const server = createHttpServer({ service: {}, preferences, community, botToken: BOT_TOKEN });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, user, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${initDataFor(user)}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  for (const [user, subgroup] of [[HEADMAN, null], [STUDENT, 1], [OTHER, 2]]) {
    await preferences.set(user.id, { selection: GROUP, subgroup, name: user.first_name });
  }
  await community.setChat(-500, { group: GROUP, headman: { userId: HEADMAN.id, name: 'Маша' }, editors: [] });
  return { call, community, preferences, filePath: join(directory, 'community.json') };
};

test('просмотр ДЗ: первый раз фиксируется, староста видит «из скольких»', async (t) => {
  const { call, community } = await setup(t);

  // Пока ДЗ нет, смотреть нечего.
  assert.deepEqual((await call('/api/homework/views', STUDENT, 'POST', VIEW)).body, { recorded: false, reach: null });

  await community.upsertHomework({ ...LESSON, text: 'Прочитать главу', authorId: HEADMAN.id });
  const first = await call('/api/homework/views', STUDENT, 'POST', VIEW);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { recorded: true, reach: null });
  assert.equal((await call('/api/homework/views', STUDENT, 'POST', VIEW)).body.recorded, false);

  const headman = await call('/api/homework/views', HEADMAN, 'POST', VIEW);
  assert.deepEqual(headman.body.reach, { seen: 2, total: 3 });
});

test('ДЗ подгруппы считается только среди её участников', async (t) => {
  const { call, community } = await setup(t);
  await community.upsertHomework({ ...LESSON, subgroup: 1, text: 'Лаба 3', authorId: HEADMAN.id });
  await call('/api/homework/views', STUDENT, 'POST', { ...VIEW, subgroup: 1 });
  const { body } = await call('/api/homework/views', HEADMAN, 'POST', { ...VIEW, subgroup: 1 });
  // Иван во второй подгруппе: знаменатель — староста без подгруппы и Аня.
  assert.deepEqual(body.reach, { seen: 2, total: 2 });
});

test('проверяет тело запроса', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/api/homework/views', STUDENT, 'POST', { ...VIEW, date: '24.09.2099' })).body.error, 'invalid_date');
  assert.equal((await call('/api/homework/views', STUDENT, 'POST', { ...VIEW, lessonNumber: 0 })).body.error, 'invalid_lesson');
  assert.equal((await call('/api/homework/views', STUDENT, 'POST', { ...VIEW, subgroup: 3 })).body.error, 'invalid_subgroup');
  assert.equal((await call('/api/homework/views', STUDENT, 'GET')).status, 405);
});

test('медиана до первого просмотра за 14 дней — только старосте, автор не учитывается', async (t) => {
  const { call, community } = await setup(t);
  assert.equal((await call('/api/homework/views/summary', STUDENT)).status, 403);
  assert.equal((await call('/api/homework/views/summary', HEADMAN)).body.medianMinutes, null);

  const item = await community.upsertHomework({ ...LESSON, text: 'Прочитать главу', authorId: HEADMAN.id });
  const start = Date.parse(item.createdAt);
  const key = '2099-09-24:2:0';
  await community.recordHomeworkView({ userId: HEADMAN.id, groupId: GROUP.id, key, at: new Date(start + 1_000).toISOString() });
  await community.recordHomeworkView({ userId: STUDENT.id, groupId: GROUP.id, key, at: new Date(start + 10 * 60_000).toISOString() });
  await community.recordHomeworkView({ userId: OTHER.id, groupId: GROUP.id, key, at: new Date(start + 30 * 60_000).toISOString() });

  const { body } = await call('/api/homework/views/summary', HEADMAN);
  assert.deepEqual(body, { days: 14, homework: 1, views: 2, medianMinutes: 20 });

  // ДЗ старше 14 дней в окно не попадает.
  const later = await community.homeworkViewStats(GROUP.id, { now: new Date(start + 15 * 86_400_000) });
  assert.equal(later.medianMinutes, null);
});

test('удаление аккаунта стирает просмотры, схема хранилища не меняется', async (t) => {
  const { call, community, filePath } = await setup(t);
  await community.upsertHomework({ ...LESSON, text: 'Прочитать главу', authorId: HEADMAN.id });
  await call('/api/homework/views', STUDENT, 'POST', VIEW);
  await call('/api/homework/views', OTHER, 'POST', VIEW);
  assert.equal((await call('/api/me', STUDENT, 'DELETE')).status, 200);

  const saved = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(saved.schemaVersion, 4);
  assert.deepEqual(saved.homeworkViews.map((view) => view.userId), [OTHER.id]);
  assert.deepEqual([...await community.homeworkViewers(GROUP.id, '2099-09-24:2:0')], [String(OTHER.id)]);
});

test('просмотры переезжают вместе с ДЗ и сбрасываются при удалении', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-views-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new CommunityStore(join(directory, 'community.json'));
  await store.upsertHomework({ ...LESSON, text: 'Прочитать главу' });
  await store.recordHomeworkView({ userId: 1, groupId: GROUP.id, key: '2099-09-24:2:0' });

  await store.relocateHomework(GROUP.id, { date: '2099-09-24', lessonNumber: 2, time: '10:00–11:30', subject: 'Тестирование', subgroup: null },
    { date: '2099-09-25', lessonNumber: 3, time: '11:45–13:15', subgroup: null }, { id: 'move-1' });
  assert.equal((await store.homeworkViewers(GROUP.id, '2099-09-24:2:0')).size, 0);
  assert.deepEqual([...await store.homeworkViewers(GROUP.id, '2099-09-25:3:0')], ['1']);

  await store.removeHomework({ ...LESSON, lessonDate: '2099-09-25', lessonNumber: 3 });
  assert.equal((await store.homeworkViewers(GROUP.id, '2099-09-25:3:0')).size, 0);

  // Файл прежнего выпуска без поля читается, номер схемы прежний.
  const legacyPath = join(directory, 'legacy.json');
  await writeFile(legacyPath, JSON.stringify({ schemaVersion: 4, chats: {}, homework: [] }));
  const legacy = new CommunityStore(legacyPath);
  assert.equal(await legacy.recordHomeworkView({ userId: 1, groupId: GROUP.id, key: '2099-09-25:3:0' }), true);
  assert.equal(JSON.parse(await readFile(legacyPath, 'utf8')).schemaVersion, 4);
});
