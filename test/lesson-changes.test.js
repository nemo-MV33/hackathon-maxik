import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';
import { LessonChangeService, lessonSlot } from '../src/services/lesson-change-service.js';
import { ScheduleService } from '../src/services/schedule-service.js';
import { NotificationService, diffSchedules } from '../src/services/notification-service.js';
import { createHttpServer } from '../src/http/server.js';

const FROM = { date: '2026-10-19', lessonNumber: 1, time: '08:15–09:45', subject: 'Математика', lessonType: 'лекция', teachers: ['Иванова'], auditories: [], subgroup: null };
const TO = { ...FROM, date: '2026-10-20', lessonNumber: 2, time: '10:00–11:30' };
const range = { from: '2026-10-18', to: '2026-11-01' };
const GROUP = { kind: 'group', id: 1, title: 'ДЕМО-25-1' };
const NOW = new Date('2026-10-18T10:00:00+08:00');
const USER = { id: 1, first_name: 'Аня' };
const oldHomework = { groupId: 1, lessonDate: FROM.date, lessonNumber: FROM.lessonNumber, lessonTime: FROM.time, subject: FROM.subject, subgroup: null, text: 'Задачи 1–5' };

const setup = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-moves-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const community = new CommunityStore(join(directory, 'community.json'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  await community.setChat(-1, { group: GROUP, headman: { userId: 1, name: 'Аня' }, editors: [{ userId: 3, name: 'Редактор' }] });
  for (const id of [1, 2, 3]) await preferences.set(id, { selection: GROUP, lang: 'ru' });
  const sent = [];
  const bot = { api: {
    sendMessageToChat: async (chatId, text) => { sent.push({ chatId, text }); },
    sendMessageToUser: async (userId, text) => { sent.push({ userId, text }); },
  } };
  const state = { lessons: [FROM, TO] };
  let changes;
  const service = { groupSchedule: async (id, { raw, week } = {}) => {
    const from = week?.toISOString().slice(0, 10) ?? range.from;
    return { period: { from: week ?? NOW, to: week ?? NOW }, lessons: raw ? state.lessons : await changes.overlay(id, state.lessons, from, '2026-11-01') };
  } };
  changes = new LessonChangeService({ community, preferences, service, bot, now: () => NOW });
  return { directory, community, preferences, changes, sent, service, state, bot };
};

const homework = (community) => community.homeworkForGroup(1, range);

test('перенос: предмет, тип, преподаватели и подгруппа; ближайший кандидат', () => {
  assert.deepEqual(diffSchedules([FROM], [TO], range), [{ type: 'moved', previous: FROM, lesson: TO }]);
  const far = { ...TO, date: '2026-10-30' };
  const result = diffSchedules([FROM], [far, TO], range);
  assert.equal(result.find((item) => item.type === 'moved').lesson, TO);
  assert.equal(result.find((item) => item.type === 'added').lesson, far);
  for (const patch of [{ lessonType: 'практика' }, { teachers: ['Петров'] }, { subgroup: 1 }, { subject: 'Физика' }]) {
    assert.deepEqual(diffSchedules([FROM], [{ ...TO, ...patch }], range).map((item) => item.type).sort(), ['added', 'cancelled']);
  }
  assert.deepEqual(diffSchedules([FROM], [], range), [{ type: 'cancelled', lesson: FROM }]);
  assert.deepEqual(diffSchedules([FROM], [{ ...TO, date: '2027-01-01' }], range).map((item) => item.type), ['cancelled']);
});

test('перенос распознаётся и при замене предмета в старом слоте', () => {
  const replacement = { ...FROM, subject: 'Физика' };
  const changes = diffSchedules([FROM], [replacement, TO], range);
  assert.deepEqual(changes.map((item) => item.type).sort(), ['added', 'moved']);
});

test('общее ДЗ, личные версии, относительное и фиксированное напоминания следуют за парой', async (t) => {
  const { community, preferences, changes, directory } = await setup(t);
  await community.upsertHomework(oldHomework);
  await community.setPersonalHomework(2, { ...oldHomework, text: 'Мои задачи' });
  for (const [id, reminder] of [[1, { mode: 'lesson', minutesBefore: 10, at: '2026-10-19T00:05:00Z' }], [2, { mode: 'fixed', at: '2026-10-19T12:00:00Z' }], [3, { at: '2026-10-17T12:00:00Z' }]]) {
    await preferences.set(id, { ...await preferences.get(id), homeworkReminders: { [lessonSlot(FROM)]: reminder } });
  }
  await changes.official(1, { type: 'moved', previous: FROM, lesson: TO }, 'official-1');
  await changes.official(1, { type: 'moved', previous: FROM, lesson: TO }, 'official-1');
  const shared = (await homework(community))[0];
  assert.equal(shared.lessonDate, TO.date);
  assert.equal(shared.lessonNumber, TO.lessonNumber);
  assert.equal(shared.text, oldHomework.text);
  assert.equal(shared.history.filter((event) => event.type === 'moved').length, 1);
  assert.deepEqual({ type: shared.history.find((event) => event.type === 'moved').type, from: shared.history.find((event) => event.type === 'moved').from, to: shared.history.find((event) => event.type === 'moved').to, at: shared.history.find((event) => event.type === 'moved').at, by: shared.history.find((event) => event.type === 'moved').by },
    { type: 'moved', from: FROM, to: TO, at: NOW.toISOString(), by: 'schedule' });
  assert.equal((await community.homeworkForUser(1, 2, range))[0].personalText, 'Мои задачи');
  assert.equal((await preferences.get(1)).homeworkReminders[lessonSlot(TO)].at, '2026-10-20T01:50:00.000Z');
  assert.equal((await preferences.get(2)).homeworkReminders[lessonSlot(TO)].at, '2026-10-19T12:00:00Z');
  assert.deepEqual((await preferences.get(3)).homeworkReminders, {});
  const reloaded = new CommunityStore(join(directory, 'community.json'));
  assert.equal((await homework(reloaded))[0].history.filter((event) => event.type === 'moved').length, 1);
  assert.ok(JSON.parse(await readFile(join(directory, 'community.json'), 'utf8')).personalHomework[0].history);
});

test('отмена сохраняет ДЗ, личную версию и статус orphaned; отметку можно отменить', async (t) => {
  const { community, changes, preferences } = await setup(t);
  await community.upsertHomework(oldHomework);
  await community.setPersonalHomework(2, { ...oldHomework, text: 'Личное' });
  await preferences.set(2, { selection: GROUP, homeworkReminders: { [lessonSlot(FROM)]: { at: TO.date + 'T10:00:00Z' } } });
  const mark = await changes.manual({ groupId: 1, user: USER, from: FROM, to: null });
  assert.equal((await community.orphanedHomework(1)).length, 1);
  assert.equal((await community.homeworkForUser(1, 2, range))[0].status, 'orphaned');
  assert.equal((await community.homeworkForUser(1, 2, range))[0].personalText, 'Личное');
  assert.equal((await preferences.get(2)).homeworkReminders[lessonSlot(FROM)].suspended, true);
  await changes.undo(1, USER, mark.id);
  assert.equal((await homework(community))[0].status, 'active');
  assert.equal((await community.orphanedHomework(1)).length, 0);
});

test('ручная отметка видна группе с автором; подтверждение вуза без второго уведомления', async (t) => {
  const { community, changes, sent } = await setup(t);
  await community.upsertHomework(oldHomework);
  const mark = await changes.manual({ groupId: 1, user: USER, from: FROM, to: TO });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Пара Математика перенесена с/);
  assert.match(sent[0].text, /Задачи 1–5/);
  assert.match(sent[0].text, /Отмечено старостой, Аня/);
  const overlay = await changes.overlay(1, [FROM, TO], range.from, range.to);
  assert.equal(overlay.length, 1);
  assert.equal(overlay[0].markedBy, 'Аня');
  assert.equal(overlay[0].date, TO.date);
  assert.equal((await changes.manual({ groupId: 1, user: USER, from: FROM, to: TO })).id, mark.id);
  assert.equal(sent.length, 1);
  assert.equal((await changes.official(1, { type: 'moved', previous: FROM, lesson: TO }, 'confirmed')).silent, true);
  assert.equal((await community.lessonChanges(1))[0].status, 'confirmed');
  assert.equal(sent.length, 1);
  assert.equal((await homework(community))[0].history.filter((event) => event.type === 'moved').length, 1);
});

test('расхождение: приоритет вуза, ДЗ переходит ещё раз, автор получает сообщение', async (t) => {
  const { community, changes, sent } = await setup(t);
  await community.upsertHomework(oldHomework);
  await changes.manual({ groupId: 1, user: USER, from: FROM, to: TO });
  const official = { ...TO, date: '2026-10-21' };
  await changes.official(1, { type: 'moved', previous: FROM, lesson: official }, 'conflict');
  assert.equal((await community.lessonChanges(1))[0].status, 'conflict');
  assert.equal((await homework(community))[0].lessonDate, official.date);
  assert.equal((await homework(community))[0].history.filter((event) => event.type === 'moved').length, 2);
  assert.match(sent.find((item) => item.userId === 1).text, /Расписание вуза отличается/);
  assert.deepEqual(await changes.overlay(1, [official], range.from, range.to), [official]);
});

test('редактор может отметить перенос и отменить его; студент не может', async (t) => {
  const { changes, community } = await setup(t);
  await community.upsertHomework(oldHomework);
  await assert.rejects(changes.manual({ groupId: 1, user: { id: 2 }, from: FROM, to: TO }), { status: 403 });
  const mark = await changes.manual({ groupId: 1, user: { id: 3, first_name: 'Редактор' }, from: FROM, to: TO });
  await assert.rejects(changes.undo(1, { id: 2 }, mark.id), { status: 403 });
  await changes.undo(1, { id: 3 }, mark.id);
  assert.equal((await homework(community))[0].lessonDate, FROM.date);
  assert.equal((await community.lessonChanges(1))[0].status, 'revoked');
});

test('автоматическая проверка переносит ДЗ и уведомляет один раз; чаты без пользователей тоже активны', async (t) => {
  const { community, changes, preferences, service, state, bot, sent, directory } = await setup(t);
  await preferences.delete(1);
  await preferences.delete(2);
  await preferences.delete(3);
  state.lessons = [FROM];
  const notifications = new NotificationService({ community, preferences, service, bot, lessonChanges: changes,
    snapshotsPath: join(directory, 'snapshots.json'), now: () => NOW });
  await community.upsertHomework(oldHomework);
  await notifications.checkChanges();
  state.lessons = [TO];
  await notifications.checkChanges();
  assert.equal(sent.filter((item) => item.chatId).length, 1);
  assert.equal((await homework(community))[0].lessonDate, TO.date);
  await notifications.checkChanges();
  assert.equal(sent.length, 1);
});

test('HTTP: права, валидация, подтверждённые роли, orphaned и перепривязка', async (t) => {
  const { changes, preferences, community, service } = await setup(t);
  await community.upsertHomework(oldHomework);
  const servers = [];
  t.after(() => servers.forEach((server) => server.close()));
  const callAs = async (id, path, method = 'GET', body) => {
    const server = createHttpServer({ preferences, community, service, lessonChanges: changes, devUserId: id });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, resolve));
    return fetch(`http://localhost:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  };
  assert.equal((await callAs(2, '/api/lesson-changes', 'POST', { from: FROM, to: TO })).status, 403);
  assert.equal((await callAs(1, '/api/lesson-changes', 'POST', { from: FROM })).status, 400);
  assert.equal((await callAs(1, '/api/lesson-changes', 'POST', { from: FROM, to: FROM })).status, 400);
  assert.equal((await callAs(1, '/api/lesson-changes', 'POST', { from: FROM, to: null })).status, 200);
  assert.equal((await callAs(2, '/api/homework/orphaned')).status, 403);
  const orphans = await (await callAs(3, '/api/homework/orphaned')).json();
  assert.equal(orphans.items.length, 1);
  assert.equal((await callAs(3, '/api/homework/orphaned', 'PUT', { id: orphans.items[0].id, to: TO })).status, 200);
  assert.equal((await homework(community))[0].lessonDate, TO.date);
  const visible = await (await callAs(2, '/api/lesson-changes')).json();
  assert.equal(visible.items.length, 1);
});

test('исчезновение сегодня запускает поиск переноса в остальных неделях диапазона', async (t) => {
  const { community, changes, preferences, state, bot, directory } = await setup(t);
  const from = { ...FROM, date: '2026-10-18' };
  const to = { ...TO, date: '2026-10-28' };
  state.lessons = [from];
  const requested = [];
  const service = { groupSchedule: async (id, { week }) => {
    const start = new Date(week); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    requested.push(start.toISOString().slice(0, 10));
    return { lessons: state.lessons.filter((lesson) => new Date(lesson.date) >= start && new Date(lesson.date) <= end) };
  } };
  const notifications = new NotificationService({ community, preferences, service, bot, lessonChanges: changes,
    snapshotsPath: join(directory, 'snapshots.json'), now: () => NOW });
  await community.upsertHomework({ ...oldHomework, lessonDate: from.date });
  await notifications.checkChanges();
  requested.length = 0;
  state.lessons = [to];
  await notifications.checkChanges({ near: true });
  assert.ok(requested.includes('2026-10-26'));
  assert.equal((await homework(community))[0].lessonDate, to.date);
  assert.equal((await homework(community))[0].status, 'active');
});

test('поздно опубликованный перенос восстанавливает orphaned ДЗ автоматически', async (t) => {
  const { community, changes, preferences, service, state, bot, directory } = await setup(t);
  const notifications = new NotificationService({ community, preferences, service, bot, lessonChanges: changes,
    snapshotsPath: join(directory, 'snapshots.json'), now: () => NOW });
  await community.upsertHomework(oldHomework);
  state.lessons = [FROM];
  await notifications.checkChanges();
  state.lessons = [];
  await notifications.checkChanges();
  assert.equal((await homework(community))[0].status, 'orphaned');
  state.lessons = [TO];
  await notifications.checkChanges();
  assert.equal((await homework(community))[0].status, 'active');
  assert.equal((await homework(community))[0].lessonDate, TO.date);
});

test('подтверждение отмены не повторяет уведомление; история операции переживает повтор', async (t) => {
  const { community, changes, sent } = await setup(t);
  await community.upsertHomework(oldHomework);
  await changes.manual({ groupId: 1, user: USER, from: FROM, to: null });
  const cancelled = { type: 'cancelled', lesson: FROM };
  assert.equal((await changes.official(1, cancelled, 'cancel-confirmed')).silent, true);
  assert.equal((await changes.official(1, cancelled, 'cancel-confirmed')).silent, true);
  assert.equal((await community.lessonChanges(1))[0].status, 'confirmed');
  assert.equal(sent.length, 1);
  assert.equal((await homework(community))[0].status, 'orphaned');
});

test('университет оставил пару в исходном слоте с другой аудиторией: ручной перенос снимается', async (t) => {
  const { community, changes, sent } = await setup(t);
  await community.upsertHomework(oldHomework);
  await changes.manual({ groupId: 1, user: USER, from: FROM, to: TO });
  const actual = { ...FROM, auditories: ['В-204'] };
  await changes.official(1, { type: 'room', previous: FROM, lesson: actual }, 'room-conflict');
  assert.equal((await homework(community))[0].lessonDate, FROM.date);
  assert.equal((await community.lessonChanges(1))[0].status, 'conflict');
  assert.ok(sent.some((item) => item.userId === 1));
});

test('уведомления чату различают добавление, аудиторию и отмену; EN поддерживается', async (t) => {
  const { community, changes, sent } = await setup(t);
  await community.setChat(-1, { lang: 'en' });
  await changes.notifyChats(1, [{ type: 'added', lesson: FROM }]);
  assert.doesNotMatch(sent[0].text, /cancelled/);
  await changes.notifyChats(1, [{ type: 'room', previous: { ...FROM, auditories: ['A'] }, lesson: { ...FROM, auditories: ['B'] } }]);
  assert.match(sent[1].text, /A.*B/);
  assert.doesNotMatch(sent[1].text, /cancelled/);
});

test('расписание применяет оверлей после нормализации, другую подгруппу не добавляет', async () => {
  const updatedAt = '2026-10-18T01:00:00Z';
  const payload = { schedule: [{ id: 1, type: 'day', dt: FROM.date, para: 1, title: FROM.subject, nt: 1, ngroup: 1 }] };
  const client = { groupSchedule: async () => payload, groups: async () => [], teachers: async () => [], auditories: async () => [], updatedAt: () => updatedAt };
  const moved = { ...TO, subgroup: 1, markedBy: 'Аня' };
  const service = new ScheduleService(client, { lessonChanges: { overlay: async () => [moved] } });
  const own = await service.groupSchedule(1, { week: new Date(2026, 9, 19), subgroup: 1 });
  assert.equal(own.lessons[0].date, TO.date);
  assert.equal(own.lessons[0].markedBy, 'Аня');
  assert.equal(own.lessons[0].updatedAt, updatedAt);
  assert.deepEqual((await service.groupSchedule(1, { week: new Date(2026, 9, 19), subgroup: 2 })).lessons, []);
  const raw = await service.groupSchedule(1, { week: new Date(2026, 9, 19), raw: true });
  assert.equal(raw.lessons[0].date, FROM.date);
  assert.equal(raw.lessons[0].markedBy, undefined);
});


test('старый снимок без типа занятия обновляет базу без отмены ДЗ и ложной рассылки', async (t) => {
  const { community, changes, preferences, service, state, bot, directory, sent } = await setup(t);
  const { lessonType, ...legacy } = FROM;
  const snapshotsPath = join(directory, 'snapshots.json');
  await writeFile(snapshotsPath, JSON.stringify({ 1: { ...range, takenAt: NOW.toISOString(), lessons: [legacy] } }));
  await community.upsertHomework(oldHomework);
  state.lessons = [FROM];
  const notifications = new NotificationService({ community, preferences, service, bot, lessonChanges: changes, snapshotsPath, now: () => NOW });
  assert.equal(await notifications.checkChanges({ near: true }), 0);
  assert.equal(sent.length, 0);
  assert.equal((await homework(community))[0].lessonDate, FROM.date);
  assert.equal((await homework(community))[0].status, 'active');
  assert.equal((await homework(community))[0].history.some((event) => ['moved', 'orphaned'].includes(event.type)), false);
  assert.equal(JSON.parse(await readFile(snapshotsPath, 'utf8'))['irnitu~1'].schemaVersion, 2);
  state.lessons = [TO];
  await notifications.checkChanges();
  assert.equal((await homework(community))[0].lessonDate, TO.date);
  assert.equal(sent.filter((item) => item.chatId).length, 1);
});

test('custom move adds a separate class without replacing an occupied slot; homework and reminders follow', async (t) => {
  const { community, preferences, changes, state } = await setup(t);
  await community.upsertHomework(oldHomework);
  await community.setPersonalHomework(2, { ...oldHomework, text: 'Личная версия' });
  await preferences.set(2, { ...await preferences.get(2), homeworkReminders: { [lessonSlot(FROM)]: { mode: 'lesson', minutesBefore: 10, at: '2026-10-19T00:05:00Z' } } });
  const moved = await changes.manual({ groupId: 1, user: USER, from: FROM, to: { custom: true, date: TO.date, time: TO.time } });
  assert.ok(moved.to.lessonNumber >= 1000);
  const overlay = await changes.overlay(1, state.lessons, range.from, range.to);
  assert.equal(overlay.length, 2);
  assert.ok(overlay.some((item) => item.lessonNumber === TO.lessonNumber));
  const custom = overlay.find((item) => item.lessonNumber === moved.to.lessonNumber);
  assert.equal(custom.subject, FROM.subject);
  assert.equal(custom.startsAt, '2026-10-20T02:00:00.000Z');
  assert.equal(custom.endsAt, '2026-10-20T03:30:00.000Z');
  const items = await community.homeworkForUser(1, 2, range);
  assert.equal(items[0].lessonNumber, moved.to.lessonNumber);
  assert.equal(items[0].personalText, 'Личная версия');
  assert.equal((await preferences.get(2)).homeworkReminders[lessonSlot(moved.to)].at, '2026-10-20T01:50:00.000Z');
  await changes.undo(1, USER, moved.id);
  assert.equal((await homework(community))[0].lessonNumber, FROM.lessonNumber);
  assert.deepEqual(await changes.overlay(1, state.lessons, range.from, range.to), state.lessons);
});

test('custom target rejects invalid date, clocks, unchanged time and student writes', async (t) => {
  const { changes } = await setup(t);
  for (const target of [
    { date: '2026-02-30', time: '10:00–11:30' }, { date: TO.date, time: '24:00–25:00' },
    { date: TO.date, time: '11:00–10:00' }, { date: TO.date, time: '10:00–10:00' },
    { date: [TO.date], time: TO.time }, { date: TO.date, time: [TO.time] },
    { date: FROM.date, time: FROM.time },
  ]) await assert.rejects(changes.manual({ groupId: 1, user: USER, from: FROM, to: { ...target, custom: true } }), { error: 'invalid_target' });
  await assert.rejects(changes.manual({ groupId: 1, user: { id: 2 }, from: FROM, to: { custom: true, date: TO.date, time: TO.time } }), { status: 403 });
});

test('official confirmation converts a custom move to the official slot without losing homework', async (t) => {
  const { changes, community, state } = await setup(t);
  await community.upsertHomework(oldHomework);
  const move = await changes.manual({ groupId: 1, user: USER, from: FROM, to: { custom: true, date: TO.date, time: TO.time } });
  state.lessons = [TO];
  const result = await changes.official(1, { type: 'moved', previous: FROM, lesson: TO }, 'custom-confirm');
  assert.equal(result.silent, true);
  assert.equal((await community.lessonChanges(1)).find((item) => item.id === move.id).status, 'confirmed');
  assert.equal((await homework(community))[0].lessonNumber, TO.lessonNumber);
  assert.equal((await homework(community))[0].text, oldHomework.text);
});

test('custom move can be rescheduled atomically and undone to the original class', async (t) => {
  const { changes, community, state } = await setup(t);
  await community.upsertHomework(oldHomework);
  const first = await changes.manual({ groupId: 1, user: USER, from: FROM, to: { custom: true, date: TO.date, time: TO.time } });
  const edited = await changes.manual({ groupId: 1, user: USER, from: FROM, to: { custom: true, date: '2026-10-22', time: '15:00–16:30' } });
  assert.equal(edited.id, first.id);
  assert.equal((await community.lessonChanges(1)).length, 1);
  assert.equal((await homework(community))[0].lessonDate, '2026-10-22');
  const overlay = await changes.overlay(1, state.lessons, range.from, range.to);
  assert.equal(overlay.length, 2); assert.equal(overlay.at(-1).time, '15:00–16:30');
  await changes.undo(1, USER, first.id);
  assert.equal((await homework(community))[0].lessonDate, FROM.date);
  assert.equal((await homework(community))[0].text, oldHomework.text);
});

test('HTTP custom move remains editable as homework and completion at its new time', async (t) => {
  const { service, community, preferences, changes } = await setup(t);
  await community.upsertHomework(oldHomework);
  const server = createHttpServer({ service, community, preferences, lessonChanges: changes, devUserId: 1 });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (path, body, method = 'PUT') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const moved = await put('/api/lesson-changes', { from: FROM, to: { custom: true, date: '2026-10-22', time: '14:00–15:30' } }, 'POST');
  assert.equal(moved.status, 200); const target = (await moved.json()).item.to;
  const saved = await put('/api/homework', { date: target.date, lessonNumber: target.lessonNumber, subgroup: null, scope: 'shared', text: 'ДЗ к новому времени' });
  assert.equal(saved.status, 200);
  const item = (await saved.json()).item;
  const marked = await put('/api/homework', { date: item.date, lessonNumber: item.lessonNumber, subgroup: null, scope: 'completion', completed: true, revision: item.completionRevision });
  assert.equal(marked.status, 200);
  const result = await (await fetch(`${base}/api/homework?groupId=1&from=2026-10-22&to=2026-10-22`)).json();
  assert.equal(result.items[0].completed, true);
  assert.equal(result.items[0].dueAt, '2026-10-22T06:00:00.000Z');
});
