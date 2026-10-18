import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEMO_GROUP, installDemo, demoContext, demoLessons } from '../src/services/demo-service.js';
import { resetDemo } from '../src/services/demo-reset.js';
import { createHttpServer } from '../src/http/server.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';
import { LessonChangeService } from '../src/services/lesson-change-service.js';

const setup = async (t, userId) => {
  const before = process.env.DEMO_MAX_IDS; process.env.DEMO_MAX_IDS = '1,2,3';
  t.after(() => { if (before === undefined) delete process.env.DEMO_MAX_IDS; else process.env.DEMO_MAX_IDS = before; });
  const root = await mkdtemp(join(tmpdir(), 'norfly-demo-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const community = new CommunityStore(join(root, 'community.json')); const preferences = new PreferencesStore(join(root, 'preferences.json'));
  let sourceCalls = 0;
  const service = installDemo({ groups: async () => { sourceCalls += 1; return []; }, searchGroups: async () => { sourceCalls += 1; return []; }, groupSchedule: async () => { throw new Error('no_real_api'); } });
  const changes = new LessonChangeService({ service, community, preferences }); service.lessonChanges = changes;
  const server = createHttpServer({ service, community, preferences, lessonChanges: changes, devUserId: userId, apiAccessKey: 'test-key' });
  await new Promise((done) => server.listen(0, '127.0.0.1', done)); t.after(() => new Promise((done) => server.close(done)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { root, community, preferences, service, changes, url, sourceCalls: () => sourceCalls };
};
test('demo hidden from anonymous, bearer and non-allowlisted users; same response as unknown group', async (t) => {
  const { url, service } = await setup(t, 99);
  assert.deepEqual(await (await fetch(`${url}/api/groups?q=ДЕМО`)).json(), { items: [] });
  const demo = await fetch(`${url}/api/schedule/group/${DEMO_GROUP.id}`); const missing = await fetch(`${url}/api/schedule/group/irnitu~999999992`);
  assert.equal(demo.status, 404); assert.equal(missing.status, demo.status); assert.deepEqual(await demo.json(), await missing.json());
  const response = await fetch(`${url}/api/me`, { method: 'PUT', body: JSON.stringify({ groupId: DEMO_GROUP.id }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(response.status, 404);
  assert.deepEqual(await demoContext.run({ userId: null }, () => service.groups()), []);
});
test('allowlisted MAX user finds demo, selects it, sees schedule and makes manual move without university API', async (t) => {
  const { url, community, preferences, sourceCalls } = await setup(t, 1);
  await resetDemo({ community, preferences, ids: ['1', '2', '3'], chatId: -100, now: new Date('2026-10-18T00:00:00Z') });
  const search = await (await fetch(`${url}/api/groups?q=ДЕМО`)).json(); assert.equal(search.items[0].id, DEMO_GROUP.id);
  const selected = await fetch(`${url}/api/me`, { method: 'PUT', body: JSON.stringify({ groupId: DEMO_GROUP.id }), headers: { 'Content-Type': 'application/json' } }); assert.equal(selected.status, 200);
  const schedule = await (await fetch(`${url}/api/schedule/group/${DEMO_GROUP.id}?week=2026-10-19`)).json(); assert.equal(schedule.lessons.length, 3);
  const [from, to] = schedule.lessons;
  const moved = await fetch(`${url}/api/lesson-changes`, { method: 'POST', body: JSON.stringify({ from, to }), headers: { 'Content-Type': 'application/json' } }); assert.equal(moved.status, 200);
  const rows = await community.homeworkForGroup(DEMO_GROUP.id, { from: '2026-10-19' }); assert.equal(rows[0].lessonDate, '2026-10-20');
  const overlay = await (await fetch(`${url}/api/schedule/group/${DEMO_GROUP.id}?week=2026-10-19`)).json(); assert.ok(overlay.lessons.some((lesson) => lesson.markedBy));
  assert.equal(sourceCalls(), 0);
});
test('demo reset clears only demo data, reminders and marks, restores seed, remains idempotent', async (t) => {
  const { community, preferences } = await setup(t, 1);
  const lesson = demoLessons(new Date('2026-10-19'))[0];
  await community.upsertHomework({ groupId: 'bgu~11', lessonDate: lesson.date, lessonNumber: 1, lessonTime: lesson.time, text: 'Настоящая группа' });
  await preferences.set(2, { selection: { ...DEMO_GROUP, kind: 'group' }, homeworkReminders: { x: { at: '2099' } } });
  const options = { community, preferences, ids: ['1', '2', '3'], chatId: -100, now: new Date('2026-10-18') };
  await resetDemo(options); await community.setPersonalHomework(2, { groupId: DEMO_GROUP.id, lessonDate: lesson.date, lessonNumber: 1, text: 'Секрет' });
  await community.saveLessonChange({ id: 'demo-move', groupId: DEMO_GROUP.id });
  await resetDemo(options); await resetDemo(options);
  assert.equal((await community.attachmentRecords()).filter((item) => item.groupId === DEMO_GROUP.id).length, 1);
  assert.equal((await community.lessonChanges(DEMO_GROUP.id)).length, 0); assert.deepEqual((await preferences.get(2)).homeworkReminders, {});
  assert.equal((await community.homeworkForGroup('bgu~11', { from: '2026-01-01' }))[0].text, 'Настоящая группа');
});

test('service Bearer cannot discover demo; revoked MAX profile does not leak it through roles', async (t) => {
  const { url, community, preferences } = await setup(t);
  const headers = { Authorization: 'Bearer test-key' };
  assert.deepEqual(await (await fetch(`${url}/api/groups?q=ДЕМО`, { headers })).json(), { items: [] });
  const demo = await fetch(`${url}/api/schedule/group/${DEMO_GROUP.id}`, { headers });
  const absent = await fetch(`${url}/api/schedule/group/irnitu~999999992`, { headers });
  assert.equal(demo.status, absent.status); assert.deepEqual(await demo.json(), await absent.json());
  await community.setChat(-99, { group: DEMO_GROUP, headman: { userId: 99 } });
  assert.equal((await demoContext.run({ userId: 99 }, () => community.chatsWithRole(99))).length, 0);
});
