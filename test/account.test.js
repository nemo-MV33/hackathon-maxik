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
const HEADMAN = { id: 3, first_name: 'Маша' };
const STUDENT = { id: 1, first_name: 'Аня' };
const OTHER = { id: 2, first_name: 'Иван' };

const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const checkString = [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

const setup = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-account-'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const community = new CommunityStore(join(directory, 'community.json'));
  const published = [];
  const server = createHttpServer({
    service: { groups: async () => [{ ...GROUP, institute: 'ИИТиАД', course: 1 }] },
    preferences, community, botToken: BOT_TOKEN,
    publishAnnouncement: async (item) => { published.push(item); return { chat: true }; },
  });
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
  for (const [user, name] of [[HEADMAN, 'Маша'], [STUDENT, 'Аня'], [OTHER, 'Иван']]) {
    await preferences.set(user.id, { selection: GROUP, subgroup: null, name });
  }
  await community.setChat(-500, { group: GROUP, headman: { userId: HEADMAN.id, name: 'Маша' }, editors: [] });
  const notice = (senderId, senderName, kind, minutes) => community.addNotice({
    chatId: -500, groupId: GROUP.id, groupTitle: GROUP.title, senderId, senderName, kind, minutes, reasonCode: null, text: 'причина', lesson: null,
  });
  await notice(STUDENT.id, 'Аня', 'late', 15);
  await notice(STUDENT.id, 'Аня', 'absent', null);
  await notice(OTHER.id, 'Иван', 'late', 5);
  return { call, preferences, community, published };
};

test('досье: староста видит минуты по каждому, студент — только свою историю', async (t) => {
  const { call } = await setup(t);
  const headman = await call('/api/absence/history', HEADMAN);
  assert.equal(headman.body.role, 'headman');
  assert.deepEqual(headman.body.students.map((item) => [item.name, item.totalMinutes]), [['Аня', 105], ['Иван', 5]], 'пропуск — целая пара, 90 минут');
  const dossier = await call(`/api/absence/history?student=${STUDENT.id}`, HEADMAN);
  assert.equal(dossier.body.student.items.length, 2);
  const student = await call('/api/absence/history', STUDENT);
  assert.equal(student.body.role, 'student');
  assert.equal(student.body.mine.length, 2);
  assert.deepEqual(student.body.students, [], 'студенту чужие опоздания не показываем');
  assert.equal((await call(`/api/absence/history?student=${OTHER.id}`, STUDENT)).body.students?.length ?? 0, 0);
});

test('доверенный одногруппник старосты выбирается только из своей группы', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/api/group/members', STUDENT)).status, 403);
  const members = await call('/api/group/members', HEADMAN);
  assert.deepEqual(members.body.members.map((item) => item.name).sort(), ['Аня', 'Иван']);
  assert.equal((await call('/api/deputy', HEADMAN, 'PUT', { userId: 999 })).status, 400);
  const saved = await call('/api/deputy', HEADMAN, 'PUT', { userId: STUDENT.id });
  assert.equal(saved.body.deputy.name, 'Аня');
  assert.equal((await call('/api/me', HEADMAN)).body.deputy.name, 'Аня');
});

test('объявления: публикует староста, каждый меняет своё напоминание', async (t) => {
  const { call, published } = await setup(t);
  const remindAt = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal((await call('/api/announcements', STUDENT, 'POST', { text: 'Привет' })).status, 403);
  const created = await call('/api/announcements', HEADMAN, 'POST', { text: 'Собрание в К-315', remindAt });
  assert.equal(created.body.postedToChat, true);
  assert.equal(published.length, 1);
  const list = await call('/api/announcements', STUDENT);
  assert.equal(list.body.items[0].myRemindAt, remindAt);
  const { id } = list.body.items[0];
  const off = await call(`/api/announcements/${id}/reminder`, STUDENT, 'PUT', { remindAt: null });
  assert.equal(off.body.item.myRemindAt, null);
  assert.equal(off.body.item.customized, true);
  const reset = await call(`/api/announcements/${id}/reminder`, STUDENT, 'PUT', { reset: true });
  assert.equal(reset.body.item.myRemindAt, remindAt);
  assert.equal((await call(`/api/announcements/${id}`, STUDENT, 'DELETE')).status, 403);
  assert.equal((await call(`/api/announcements/${id}`, HEADMAN, 'DELETE')).status, 200);
});

test('настройки уведомлений: время, общий выключатель и формы контроля', async (t) => {
  const { call } = await setup(t);
  const saved = await call('/api/me', STUDENT, 'PUT', {
    reminderMinutes: 30, summaryTime: '21:30', muted: true, controls: { 'Базы данных': 'exam' },
  });
  assert.equal(saved.body.profile.reminderMinutes, 30);
  assert.equal(saved.body.profile.summaryTime, '21:30');
  assert.equal(saved.body.profile.muted, true);
  assert.deepEqual(saved.body.profile.controls, { 'Базы данных': 'exam' });
  assert.equal((await call('/api/me', STUDENT, 'PUT', { reminderMinutes: 7 })).status, 400);
  assert.equal((await call('/api/me', STUDENT, 'PUT', { summaryTime: '03:00' })).status, 400);
  assert.equal((await call('/api/me', STUDENT, 'PUT', { controls: { x: 'magic' } })).status, 400);
});

test('удаление аккаунта: профиль стёрт, журнал группы остался, роль старосты свободна', async (t) => {
  const { call, preferences, community } = await setup(t);
  assert.equal((await call('/api/me', STUDENT, 'DELETE')).body.deleted, true);
  assert.deepEqual(await preferences.get(STUDENT.id), {});
  assert.equal((await community.noticesForGroup(GROUP.id)).length, 3);
  await call('/api/me', HEADMAN, 'DELETE');
  assert.equal((await community.getChat(-500)).headman, null);
  assert.equal((await community.noticesForGroup(GROUP.id)).length, 3, 'журнал достанется новому старосте');
});

test('напоминания на время: объявление — по своему времени, выключенное не приходит', async (t) => {
  const { NotificationService } = await import('../src/services/notification-service.js');
  const { ReminderService } = await import('../src/services/reminder-service.js');
  const { preferences, community } = await setup(t);
  const sent = [];
  const bot = { api: { sendMessageToUser: async (userId, text) => { sent.push({ userId, text }); } } };
  const at = new Date('2026-09-28T02:00:00Z');
  const item = await community.addAnnouncement({ groupId: GROUP.id, chatId: -500, groupTitle: GROUP.title, authorId: HEADMAN.id, text: 'Собрание', remindAt: at.toISOString() });
  await preferences.set(OTHER.id, { ...(await preferences.get(OTHER.id)), announcementReminders: { [item.id]: null } });
  const service = new NotificationService({ bot, service: {}, preferences, community, snapshotsPath: join(tmpdir(), `snap-${Date.now()}.json`), now: () => new Date(at.getTime() + 60_000) });
  assert.equal(await service.sendScheduled(), 2, 'староста и Аня; Иван выключил напоминание');
  assert.ok(sent.every((item) => /Собрание/.test(item.text)));
  assert.equal(await service.sendScheduled(), 0, 'повторно не шлём');

  // За N минут до пары и перед концом пары — по настройкам пользователя.
  const lesson = { date: '2026-09-28', lessonNumber: 4, time: '13:45–15:15', subject: 'Матлогика', auditories: ['К-315'], subgroup: null };
  await preferences.set(STUDENT.id, { ...(await preferences.get(STUDENT.id)), reminderMinutes: 30, notifications: { lessonEnd: true } });
  const schedule = { groupSchedule: async () => ({ lessons: [lesson] }) };
  sent.length = 0;
  const at1315 = new ReminderService({ bot, service: schedule, preferences, now: () => new Date('2026-09-28T05:15:00Z') });
  await at1315.check();
  assert.deepEqual(sent.map((item) => item.userId), [STUDENT.id], 'за 30 минут — только у того, кто так настроил');
  assert.match(sent[0].text, /Через 30 минут/);
  sent.length = 0;
  const at1510 = new ReminderService({ bot, service: schedule, preferences, now: () => new Date('2026-09-28T07:10:00Z') });
  await at1510.check();
  assert.deepEqual(sent.map((item) => item.userId), [STUDENT.id]);
  assert.match(sent[0].text, /закончится через 5 минут/);
});
