import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from '../src/http/server.js';
import { PreferencesStore } from '../src/storage/preferences.js';

const BOT_TOKEN = 'test-bot-token';

const initDataFor = (user) => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

const service = {
  groups: async () => [{ id: 478237, title: 'ИСТб-25-1', institute: 'ИИТиАД', course: 1 }],
  institutes: async () => ['ИИТиАД'],
};

const startServer = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-me-'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const server = createHttpServer({ service, preferences, botToken: BOT_TOKEN, apiAccessKey: 'key' });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://localhost:${server.address().port}`;
  const request = (path, { user, ...init } = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `tma ${initDataFor(user)}` } : {}),
    },
  });
  return { preferences, request };
};

test('GET /api/me requires valid initData', async (t) => {
  const { request } = await startServer(t);
  assert.equal((await request('/api/me')).status, 401);
  const response = await fetch((await request('/api/me')).url, {
    headers: { Authorization: 'tma user=%7B%22id%22%3A1%7D&hash=00' },
  });
  assert.equal(response.status, 401);
});

test('profile saved from the mini app is shared with the bot storage', async (t) => {
  const { preferences, request } = await startServer(t);
  const user = { id: 42, first_name: 'Вячеслав' };

  const empty = await (await request('/api/me', { user })).json();
  assert.equal(empty.user.firstName, 'Вячеслав');
  assert.equal(empty.profile.group, null);

  const saved = await request('/api/me', {
    user, method: 'PUT', body: JSON.stringify({ groupId: 478237, subgroup: 2 }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).profile.group, { id: 478237, title: 'ИСТб-25-1' });

  const stored = await preferences.get(42);
  assert.deepEqual(stored.selection, { kind: 'group', id: 478237, title: 'ИСТб-25-1' });
  assert.equal(stored.subgroup, 2);
});

test('PUT /api/me validates input', async (t) => {
  const { request } = await startServer(t);
  const user = { id: 7 };
  const put = (body) => request('/api/me', { user, method: 'PUT', body });

  assert.equal((await put('{broken')).status, 400);
  assert.equal((await put(JSON.stringify({ groupId: 1 }))).status, 400);
  assert.equal((await put(JSON.stringify({ subgroup: 5 }))).status, 400);
  assert.equal((await put('x'.repeat(70_000))).status, 413);
});

test('legacy schedule API accepts initData instead of the access key', async (t) => {
  const { request } = await startServer(t);
  assert.equal((await request('/api/institutes')).status, 401);
  const response = await request('/api/institutes', { user: { id: 42 } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, ['ИИТиАД']);
});
