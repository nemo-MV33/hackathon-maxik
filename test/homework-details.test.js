import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detailsInput, deadlineAt, dueReminderAt } from '../src/lib/homework-details.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';
import { AttachmentStore } from '../src/storage/attachments.js';
import { putHomework, getHomework } from '../src/http/routes/homework.js';
import { NotificationService } from '../src/services/notification-service.js';
import { LessonChangeService } from '../src/services/lesson-change-service.js';

const group = { kind: 'group', id: 'irnitu~11', title: 'ИСТб-25-1' };
const lesson = { date: '2099-10-19', lessonNumber: 1, time: '08:15–09:45', subject: 'Математика', subgroup: null, timeZone: 'Asia/Irkutsk' };
const next = { ...lesson, date: '2099-10-20', lessonNumber: 4, time: '13:45–15:15' };
const target = { groupId: group.id, lessonDate: lesson.date, lessonTime: lesson.time, lessonNumber: 1, subgroup: null, subject: lesson.subject };
const setup = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'norfly-details-')); t.after(() => rm(root, { recursive: true, force: true }));
  const community = new CommunityStore(join(root, 'community.json')); const preferences = new PreferencesStore(join(root, 'preferences.json'));
  community.attachmentStore = new AttachmentStore(join(root, 'files'), { community, preferences, secret: 'test', limits: { freeBytes: 0 } });
  await community.setChat(100, { group, headman: { userId: 1 }, editors: [{ userId: 3 }] });
  for (const id of [1, 2, 3, 4]) await preferences.set(id, { selection: group, timeZone: id === 2 ? 'Europe/Moscow' : 'Asia/Irkutsk', lang: 'ru' });
  const service = { groupSchedule: async () => ({ lessons: [lesson, next] }) };
  const save = (userId, text, scope = 'shared', values = {}) => putHomework({ user: { id: userId, first_name: `Автор ${userId}` }, preferences, community, service, body: { scope, text, date: lesson.date, lessonNumber: 1, subgroup: null, ...values } });
  const list = (id, from = lesson.date, to = next.date) => getHomework({ user: { id }, preferences, community, service, url: new URL(`http://test/api/homework?groupId=11&from=${from}&to=${to}`) });
  return { root, community, preferences, service, save, list };
};
test('all deadlines, university date validation, submission methods and HTTPS URLs', async () => {
  assert.deepEqual(detailsInput({ deadline: null }, group.id).deadline, { kind: 'lesson' });
  assert.equal(await deadlineAt(target), '2099-10-19T00:15:00.000Z');
  const deadline = detailsInput({ deadline: { kind: 'date', local: '2099-10-21T18:30' } }, group.id).deadline;
  assert.equal(deadline.at, '2099-10-21T10:30:00.000Z');
  assert.equal(detailsInput({ deadline: { kind: 'date', local: '2099-10-21T18:30' } }, 'bgu~11').deadline.at, deadline.at);
  for (const local of ['2099-02-30T12:00', '2099-10-21T24:00', '2099-10-21', 'garbage']) assert.throws(() => detailsInput({ deadline: { kind: 'date', local } }, group.id), { status: 400 });
  for (const kind of ['class', 'moodle', 'system', 'email', 'other']) assert.equal(detailsInput({ submission: { kind, label: 'Курс', url: 'https://example.org/course' } }, group.id).submission.kind, kind);
  for (const url of ['http://example.org', 'javascript:alert(1)', 'file:///etc/passwd', '//example.org', 'https://user:password@example.org']) assert.throws(() => detailsInput({ submission: { kind: 'other', url } }, group.id), { status: 400 });
});
test('relative due date follows moved lesson, fixed due date stays; next subject lesson resolved or unknown', async (t) => {
  const { community, service, save } = await setup(t);
  assert.equal(await deadlineAt({ ...target, deadline: { kind: 'next' } }, service), '2099-10-20T05:45:00.000Z');
  assert.equal(await deadlineAt({ ...target, deadline: { kind: 'next' } }, { groupSchedule: async () => ({ lessons: [] }) }), null);
  await save(1, 'Общее'); await save(2, 'Личное', 'personal', { deadline: { kind: 'date', local: '2099-10-22T12:00' } });
  await community.relocateHomework(group.id, lesson, next, { id: 'move', by: 'headman' });
  const records = await community.attachmentRecords();
  assert.equal(await deadlineAt(records.find((item) => !item.userId)), '2099-10-20T05:45:00.000Z');
  assert.equal(await deadlineAt(records.find((item) => item.userId)), '2099-10-22T04:00:00.000Z');
  assert.equal(records[0].history.at(-1).by, 'headman');
});
test('shared/personal details and histories stay separate; API sorted by due and accepts due outside lesson week', async (t) => {
  const { save, list, community } = await setup(t);
  await save(1, 'Общее', 'shared', { deadline: { kind: 'date', local: '2099-11-12T12:00' }, submission: { kind: 'moodle', url: 'https://example.org' } });
  await save(2, 'Только моё', 'personal', { deadline: { kind: 'next' }, submission: { kind: 'email', label: 'teacher@example.org' } });
  const own = (await list(2)).items[0]; const student = (await list(4)).items[0];
  assert.equal(own.sharedDeadline.kind, 'date'); assert.equal(own.deadline.kind, 'next'); assert.equal(own.sharedSubmission.kind, 'moodle'); assert.equal(own.personalSubmission.kind, 'email');
  assert.equal(student.personalHistory.length, 0); assert.equal(student.sharedHistory[0].after.text, 'Общее'); assert.equal(JSON.stringify(student).includes('Только моё'), false);
  assert.equal((await list(4, '2099-11-12', '2099-11-12')).items.length, 1);
  await community.upsertHomework({ ...target, lessonDate: next.date, lessonNumber: 4, lessonTime: next.time, text: 'Раньше', deadline: { kind: 'lesson' } });
  assert.equal((await list(4)).items[0].text, 'Раньше');
});
test('history stores text diff, files and details; only headman/editor restore creates new version including removed files', async (t) => {
  const { community, save, list } = await setup(t);
  const file = await community.attachmentStore.upload(Buffer.from('Тестовый файл'), { userId: 1, groupId: group.id, scope: 'shared', name: 'test.txt' });
  await save(1, 'Первое', 'shared', { attachmentIds: [file.id], submission: { kind: 'moodle' } });
  await save(3, 'Второе', 'shared', { attachmentIds: [], deadline: { kind: 'next' } });
  const current = (await list(2)).items[0]; const revision = current.sharedHistory.findLast((event) => event.type === 'edited');
  assert.equal(revision.before.text, 'Первое'); assert.equal(revision.after.text, 'Второе'); assert.equal(revision.before.attachments[0].id, file.id);
  await assert.rejects(community.attachmentStore.authorize(file.id, 2), { status: 403 });
  await assert.rejects(save(2, '', 'shared', { restoreVersion: 1 }), { status: 403 });
  const restored = await save(3, '', 'shared', { restoreVersion: 1 });
  assert.equal(restored.item.version, 3); assert.equal(restored.item.text, 'Первое'); assert.equal(restored.item.attachments[0].id, file.id);
  assert.equal(restored.item.history.at(-1).restoredFrom, 1); await community.attachmentStore.authorize(file.id, 2);
  await community.removeHomework(target); await assert.rejects(readFile(community.attachmentStore.path(file.id)), { code: 'ENOENT' });
});
test('due reminders use user morning, recompute after changed deadline, send only once', async (t) => {
  const { save, community, preferences, service } = await setup(t);
  const due = '2099-10-21T10:00:00.000Z';
  assert.equal(dueReminderAt(due, 'due-day', { timeZone: 'Europe/Moscow' }), '2099-10-20T10:00:00.000Z');
  assert.equal(dueReminderAt(due, 'due-morning', { timeZone: 'Europe/Moscow' }), '2099-10-21T05:00:00.000Z');
  await save(1, 'Задачи', 'shared', { deadline: { kind: 'date', local: '2099-10-21T18:00' } });
  await save(2, null, 'reminder', { remindAt: due, reminderMode: 'due-morning' });
  await save(1, 'Задачи', 'shared', { deadline: { kind: 'date', local: '2099-10-22T18:00' } });
  const sent = [];
  const notifications = new NotificationService({ community, preferences, service, bot: { api: { sendMessageToUser: async (...args) => sent.push(args) } }, now: () => new Date('2099-10-22T05:00:30Z') });
  assert.equal(await notifications.sendScheduled(), 1); assert.equal(await notifications.sendScheduled(), 0); assert.equal(sent.length, 1); assert.match(sent[0][1], /Срок/);
});

test('merging assignments preserves both histories and supports unambiguous restore of prior snapshots', async (t) => {
  const { community, save } = await setup(t);
  await save(1, 'Исходное');
  await community.upsertHomework({ ...target, lessonDate: next.date, lessonNumber: next.lessonNumber, lessonTime: next.time, text: 'В целевом слоте', authorId: 3 });
  await community.relocateHomework(group.id, lesson, next, { id: 'merge', by: 'headman' });
  const current = (await community.homeworkForGroup(group.id, { from: next.date }))[0];
  assert.match(current.text, /Исходное/); assert.match(current.text, /В целевом слоте/);
  const snapshots = current.history.filter((event) => event.after);
  assert.equal(new Set(snapshots.map((event) => event.version)).size, snapshots.length);
  const version = snapshots.find((event) => event.after.text === 'В целевом слоте').version;
  const restored = await community.restoreHomework(group.id, 3, current, version, 'Редактор');
  assert.equal(restored.text, 'В целевом слоте'); assert.ok(restored.version > current.version);
});

test('morning after deadline is rejected, overdue items remain visible outside requested lesson period', async (t) => {
  const { save, preferences, community, service } = await setup(t);
  assert.equal(dueReminderAt('2099-10-21T00:00:00Z', 'due-morning', { timeZone: 'Europe/Moscow' }), null);
  await save(1, 'Прошедший срок', 'shared', { deadline: { kind: 'date', local: '2000-01-01T12:00' } });
  await assert.rejects(save(2, null, 'reminder', { remindAt: '2000-01-01T04:00:00Z', reminderMode: 'due-day' }), { error: 'reminder_in_past' });
  const result = await getHomework({ user: { id: 2 }, preferences, community, service, url: new URL('http://test/api/homework?groupId=11&from=2026-10-19&to=2026-10-25&includeOverdue=true') });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].dueAt, '2000-01-01T04:00:00.000Z');
});

test('editing personal version after cancellation keeps orphaned lesson visible', async (t) => {
  const { community } = await setup(t);
  await community.setPersonalHomework(2, { ...target, text: 'Личное' });
  await community.relocateHomework(group.id, lesson, null, { id: 'cancel' });
  await community.setPersonalHomework(2, { ...target, text: 'Дополнение' });
  assert.equal((await community.orphanedLessons(group.id))[0].date, lesson.date);
});

test('restoring content version does not undo cancellation of its lesson', async (t) => {
  const { community, save } = await setup(t);
  await save(1, 'Исходное'); await save(1, 'Правка');
  await community.relocateHomework(group.id, lesson, null, { id: 'cancel' });
  const current = (await community.homeworkForGroup(group.id, { from: lesson.date }))[0];
  const restored = await community.restoreHomework(group.id, 3, current, 1, 'Редактор');
  assert.equal(restored.text, 'Исходное'); assert.equal(restored.status, 'orphaned');
});

test('completion is private, reversible and invalidated by a new assignment revision', async (t) => {
  const { save, list, preferences, community } = await setup(t);
  await save(1, 'Задачи');
  const current = (await list(2)).items[0];
  const mark = (id, completed, revision = current.completionRevision) => save(id, null, 'completion', { completed, revision });
  await mark(2, true);
  assert.equal((await list(2)).items[0].completed, true);
  assert.equal((await list(4)).items[0].completed, false);
  assert.equal((await community.homeworkForGroup(group.id, { from: lesson.date }))[0].version, 1);
  await mark(2, false);
  assert.equal((await list(2)).items[0].completed, false);
  await mark(2, true);
  await save(1, 'Новые задачи');
  assert.equal((await list(2)).items[0].completed, false);
  await assert.rejects(mark(2, true), { error: 'homework_changed' });
  await assert.rejects(save(2, null, 'completion', { completed: 'yes', revision: current.completionRevision }), { error: 'invalid_completion' });
  await preferences.set(5, { selection: { kind: 'group', id: 'bgu~12', title: 'Другая' } });
  await assert.rejects(mark(5, true), { error: 'homework_not_found' });
});

test('completion follows the effective personal version and survives a class move', async (t) => {
  const { save, list, community, preferences } = await setup(t);
  await save(1, 'Общее');
  await save(2, 'Личное', 'personal');
  const current = (await list(2)).items[0];
  await save(2, null, 'completion', { completed: true, revision: current.completionRevision });
  await save(1, 'Изменилось только общее');
  assert.equal((await list(2)).items[0].completed, true);
  await community.relocateHomework(group.id, lesson, next, { id: 'move' });
  const result = await getHomework({ user: { id: 2 }, preferences, community, service: { groupSchedule: async () => ({ lessons: [next] }) }, url: new URL(`http://test/api/homework?groupId=11&from=${next.date}&to=${next.date}`) });
  assert.equal(result.items[0].completed, true);
  await putHomework({ user: { id: 2 }, preferences, community, service: { groupSchedule: async () => ({ lessons: [next] }) }, body: { date: next.date, lessonNumber: next.lessonNumber, subgroup: null, scope: 'personal', text: null } });
  const shared = (await list(2)).items[0];
  assert.equal(shared.source, 'shared'); assert.equal(shared.completed, false);
});

test('completed homework does not send its scheduled reminder; new content enables it again', async (t) => {
  const { save, list, community, preferences, service } = await setup(t);
  await save(1, 'Задачи');
  await save(2, null, 'reminder', { remindAt: '2099-10-19T00:00:00Z' });
  await save(2, null, 'completion', { completed: true, revision: (await list(2)).items[0].completionRevision });
  const sent = [];
  const notifications = new NotificationService({ community, preferences, service, bot: { api: { sendMessageToUser: async (...args) => sent.push(args) } }, now: () => new Date('2099-10-19T00:00:30Z') });
  assert.equal(await notifications.sendScheduled(), 0);
  await save(1, 'Новый вариант');
  assert.equal(await notifications.sendScheduled(), 1);
  assert.equal(sent.length, 1);
});

test('standalone homework accepts next-year deadlines without requesting a schedule; titles remain independent', async (t) => {
  const { preferences, community } = await setup(t);
  let requests = 0;
  const service = { groupSchedule: async () => { requests++; throw Error('no_schedule'); } };
  const save = (subject) => putHomework({ user: { id: 1 }, preferences, community, service, body: { standalone: true, scope: 'shared', date: '2100-05-20', lessonNumber: 0, subgroup: null, subject, text: 'Подготовить проект', deadline: { kind: 'date', local: '2100-05-20T18:00' } } });
  const first = (await save('Курсовая')).item;
  const second = (await save('Курсовая')).item;
  assert.equal(first.standalone, true); assert.equal(first.dueAt, '2100-05-20T10:00:00.000Z');
  assert.notEqual(first.lessonNumber, second.lessonNumber);
  const list = await getHomework({ user: { id: 2 }, preferences, community, service, url: new URL('http://test/api/homework?groupId=11&from=2100-05-20&to=2100-05-20') });
  assert.equal(list.items.length, 2); assert.equal(requests, 0);
});

test('standalone homework keeps personal versions, completion, reminders and attachments private', async (t) => {
  const { preferences, community, service } = await setup(t);
  const file = await community.attachmentStore.upload(Buffer.from('Личный проект'), { userId: 2, groupId: group.id, scope: 'personal', name: 'project.txt' });
  const body = { standalone: true, scope: 'personal', date: '2100-05-20', lessonNumber: 0, subgroup: null, subject: 'Курсовая', text: '', attachmentIds: [file.id], deadline: { kind: 'date', local: '2100-05-20T18:00' }, remindAt: '2100-05-19T10:00:00Z' };
  const put = (id, patch) => putHomework({ user: { id }, preferences, community, service, body: { ...body, ...patch } });
  const item = (await put(2, {})).item;
  assert.equal(item.attachments[0].id, file.id);
  await put(2, { lessonNumber: item.lessonNumber, scope: 'completion', completed: true, revision: item.completionRevision });
  const url = new URL('http://test/api/homework?groupId=11&from=2100-05-20&to=2100-05-20');
  assert.equal((await getHomework({ user: { id: 2 }, preferences, community, service, url })).items[0].completed, true);
  assert.equal((await getHomework({ user: { id: 4 }, preferences, community, service, url })).items.length, 0);
  await assert.rejects(put(4, { lessonNumber: item.lessonNumber, text: 'Чужая правка' }), { status: 404 });
  await put(2, { lessonNumber: item.lessonNumber, text: 'Новая редакция' });
  assert.equal((await getHomework({ user: { id: 2 }, preferences, community, service, url })).items[0].completed, false);
  await putHomework({ user: { id: 2 }, preferences, community, service, body: { standalone: true, scope: 'personal', date: body.date, lessonNumber: item.lessonNumber, subgroup: null, text: null } });
  assert.equal((await preferences.get(2)).homeworkReminders[`${body.date}:${item.lessonNumber}:0`], undefined);
  assert.equal((await getHomework({ user: { id: 2 }, preferences, community, service, url })).items.length, 0);
});

test('standalone validation enforces group editing rights, a title and explicit university time', async (t) => {
  const { save } = await setup(t);
  const body = { standalone: true, lessonNumber: 0, subject: 'Проект', deadline: { kind: 'date', local: '2100-05-20T18:00' } };
  await assert.rejects(save(2, 'Задание', 'shared', body), { status: 403 });
  for (const patch of [{ subject: '' }, { subject: ['Проект'] }, { subject: 'а'.repeat(201) }]) await assert.rejects(save(1, 'Задание', 'shared', { ...body, ...patch }), { error: 'invalid_subject' });
  for (const deadline of [{ kind: 'lesson' }, { kind: 'next' }, { kind: 'date', local: '2100-02-30T12:00' }]) await assert.rejects(save(1, 'Задание', 'shared', { ...body, deadline }), { error: 'invalid_deadline' });
});

test('failed standalone attachment validation does not create a task or a phantom reminder', async (t) => {
  const { save, preferences, community } = await setup(t);
  const before = await preferences.get(1);
  await assert.rejects(save(1, 'Проект', 'shared', { standalone: true, lessonNumber: 0, subject: 'Курс', deadline: { kind: 'date', local: '2100-05-20T18:00' }, attachmentIds: ['missing'], remindAt: '2100-05-19T10:00:00Z' }));
  assert.deepEqual(await preferences.get(1), before);
  assert.equal((await community.attachmentRecords()).length, 0);
});

test('standalone shared versions can be restored; deleting the shared task preserves a student personal version and its reminder', async (t) => {
  const { preferences, community, service } = await setup(t);
  const body = { standalone: true, date: '2100-05-20', lessonNumber: 0, subgroup: null, scope: 'shared', subject: 'Проект', text: 'Первая версия', deadline: { kind: 'date', local: '2100-05-20T18:00' } };
  const initial = (await putHomework({ user: { id: 1 }, preferences, community, service, body })).item;
  const put = (id, patch) => putHomework({ user: { id }, preferences, community, service, body: { ...body, lessonNumber: initial.lessonNumber, ...patch } });
  await put(2, { scope: 'personal', text: 'Личный план', remindAt: '2100-05-19T10:00:00Z' });
  await put(3, { text: 'Вторая версия' });
  const restored = (await put(1, { restoreVersion: 1 })).item;
  assert.equal(restored.text, 'Первая версия'); assert.equal(restored.standalone, true);
  assert.equal(restored.sharedHistory.at(-1).restoredFrom, 1);
  await put(1, { text: null });
  assert.ok((await preferences.get(2)).homeworkReminders[`${body.date}:${initial.lessonNumber}:0`]);
  const own = await community.homeworkForUser(group.id, 2, { from: body.date, to: body.date });
  assert.equal(own[0].text, 'Личный план'); assert.equal(own[0].sharedText, null);
});
