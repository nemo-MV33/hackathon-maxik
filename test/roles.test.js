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
const OWN = { kind: 'group', id: 11, title: 'ИСТб-25-1' };
const OTHER = { kind: 'group', id: 12, title: 'ИСТб-25-2' };
const HEADMAN = { id: 3, first_name: 'Маша' };

const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const checkString = [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

const setup = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-roles-'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const community = new CommunityStore(join(directory, 'community.json'));
  const server = createHttpServer({ service: {}, preferences, community, botToken: BOT_TOKEN });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, init = {}) => {
    const response = await fetch(`http://localhost:${server.address().port}${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', Authorization: `tma ${initDataFor(HEADMAN)}` },
    });
    return { status: response.status, body: await response.json() };
  };
  return { preferences, community, request };
};

test('роль старосты действует в группе профиля, роль в чужой группе — подсказка', async (t) => {
  const { preferences, community, request } = await setup(t);
  // Стресс-тест владельца: чат перепривязали к другой группе, а в профиле осталась прежняя.
  await community.setChat(-5, { title: 'Презентация', group: OTHER, headman: { userId: 3, name: 'Маша' } });
  await preferences.set(3, { selection: OWN, name: 'Маша' });

  const me = (await request('/api/me')).body;
  assert.equal(me.role, 'student');
  assert.deepEqual(me.otherRoles, [{ group: { id: 'irnitu~12', title: 'ИСТб-25-2' }, chatTitle: 'Презентация', role: 'headman' }]);
  assert.equal(await community.homeworkRoleForGroup(OWN.id, 3), 'student');
  // Раздел старосты не показывает чужую группу вперемешку со своим расписанием.
  assert.equal((await request('/api/group/members')).status, 403);
  assert.equal((await request('/api/announcements', { method: 'POST', body: JSON.stringify({ text: 'Сбор в 10:00' }) })).status, 403);
  assert.equal((await request('/api/absence?date=2026-10-01')).body.role, 'student');

  await preferences.set(3, { selection: OTHER, name: 'Маша' });
  const switched = (await request('/api/me')).body;
  assert.equal(switched.role, 'headman');
  assert.deepEqual(switched.otherRoles, []);
  assert.equal(await community.homeworkRoleForGroup(OTHER.id, 3), 'headman');
  assert.equal((await request('/api/group/members')).status, 200);
});

test('второй чат той же группы и второй админ не отнимают роль старосты', async (t) => {
  const { preferences, community, request } = await setup(t);
  await preferences.set(3, { selection: OWN, name: 'Маша' });
  await community.setChat(-5, { group: OWN, headman: { userId: 3, name: 'Маша' } });
  await community.setChat(-6, { group: OWN, headman: { userId: 9, name: 'Олег' }, editors: [{ userId: 3, name: 'Маша' }] });
  assert.equal((await request('/api/me')).body.role, 'headman');
  assert.equal(await community.homeworkRoleForGroup(OWN.id, 3), 'headman');
});

test('бота удалили из чата и вернули: группа и роли восстанавливаются', async (t) => {
  const { preferences, community, request } = await setup(t);
  await preferences.set(3, { selection: OWN, name: 'Маша' });
  await community.setChat(-5, { group: OWN, headman: { userId: 3, name: 'Маша' }, editors: [{ userId: 4, name: 'Петя' }], deputy: { userId: 4, name: 'Петя' } });

  await community.removeChat(-5);
  assert.equal(await community.getChat(-5), null);
  assert.equal((await request('/api/me')).body.role, 'student');

  const restored = await community.restoreChat(-5);
  assert.equal(restored.headman.userId, 3);
  assert.deepEqual(restored.editors, [{ userId: 4, name: 'Петя' }]);
  assert.equal((await request('/api/me')).body.role, 'headman');
  assert.equal((await request('/api/me')).body.deputy.name, 'Петя');
  assert.equal(await community.restoreChat(-5), null);
});
