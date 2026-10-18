import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { htmlText, parseGroups, parseParity, parseSchedule, parseTeachers } from '../src/universities/bgu/parser.js';
import { BguProvider } from '../src/universities/bgu/provider.js';
import { UniversityService } from '../src/universities/service.js';
import { groupKey, sameGroup } from '../src/universities/identity.js';
import { PreferencesStore } from '../src/storage/preferences.js';
import { CommunityStore } from '../src/storage/community.js';
import { lessonInTimeZone, lessonMoments, zonedMoment, zonedDateKey } from '../src/lib/timezone.js';
import { isQuiet } from '../src/lib/settings.js';
import { LessonChangeService } from '../src/services/lesson-change-service.js';
import { NotificationService } from '../src/services/notification-service.js';
import { ReminderService } from '../src/services/reminder-service.js';
import { userDayLessons } from '../src/services/user-schedule.js';
import { updateMe } from '../src/http/routes/me.js';
import { createHttpServer } from '../src/http/server.js';

const fixture = (name) => readFile(new URL(`./fixtures/bgu/${name}`, import.meta.url), 'utf8');
const html = await fixture('gmu-25-1-working.html');
const evenWeek = new Date('2026-10-19T00:00:00Z');
const oddWeek = new Date('2026-10-12T00:00:00Z');
const temporary = async (t) => { const dir = await mkdtemp(join(tmpdir(), 'norfly-universities-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const stores = async (t) => {
  const dir = await temporary(t);
  return { dir, preferences: new PreferencesStore(join(dir, 'preferences.json')), community: new CommunityStore(join(dir, 'community.json')) };
};
const lesson = (date = '2026-10-19', time = '08:15–09:45') => ({ date, time, lessonNumber: 1, subject: 'Право', lessonType: 'лекция', subgroup: null, teachers: [], auditories: [] });

test('БГУ: настоящий список групп и отдельный список преподавателей', async () => {
  const groups = parseGroups(await fixture('groups.html'));
  assert.equal(groups.find((group) => group.id === 32982).title, 'ГМУ-25-1');
  assert.equal(new Set(groups.map((group) => group.id)).size, groups.length);
  assert.equal(parseTeachers(await fixture('teachers.html')).find((teacher) => teacher.id === 6795).fullName, 'Абалакова Людмила Михайловна');
});
test('БГУ: дата и нечётность взяты из настоящей страницы', () => {
  assert.deepEqual(parseParity(html), { date: '2026-10-18', weekEven: false });
});
test('БГУ: эквивалентная запись HTML сохраняет расписание без зависимости от Safari', () => {
  // Safari сериализует DOM при сохранении. Эти варианты проверяют допустимый исходный HTML, не новую фикстуру сайта.
  const variant = html.replace(/<div\b([^>]*?)class="([^"]*tab-pane[^"]*)"\s+id="([^"]+)"/g,
    "<div$1id='$3' class='$2'").replace('id="MainContent_divTT"', "id = 'MainContent_divTT'")
    .replace('18 октября', '18 Октября').replace('>Конституционное право</span>', '>Конституционное &#1087;раво</span>');
  assert.notEqual(variant, html);
  assert.deepEqual(parseSchedule(variant, { week: evenWeek, groupId: 32982 }), parseSchedule(html, { week: evenWeek, groupId: 32982 }));
  assert.equal(htmlText('&laquo;Право&raquo; &amp; &#x411;&#1043;&#1059; &lt;1&gt;'), '«Право» & БГУ <1>');
  assert.equal(htmlText('&#1114112; &#xD800; &amp;lt;'), '&#1114112; &#xD800; &lt;');
});
test('БГУ: чётная неделя, тип, преподаватель, аудитория и пустой вторник', () => {
  const result = parseSchedule(html, { week: evenWeek, groupId: 32982 });
  assert.equal(result.weekEven, true);
  assert.equal(result.lessons.length, 15);
  assert.equal(result.lessons[0].subject, 'Конституционное право');
  assert.equal(result.lessons[0].time, '14:00–15:30');
  assert.deepEqual(result.lessons[0].auditories, ['2-411']);
  assert.deepEqual(result.lessons[0].teachers, ['Хаитов Григорий Александрович']);
  assert.equal(result.lessons.some((item) => item.date === '2026-10-20'), false);
  assert.equal(result.lessons.find((item) => item.date === '2026-10-19' && item.lessonNumber === 5).lessonType, 'практика');
});
test('БГУ: нечётная неделя выбирает другую пару, скрывает чётную субботу', () => {
  const result = parseSchedule(html, { week: oddWeek, groupId: 32982 });
  assert.equal(result.weekEven, false);
  assert.equal(result.lessons.length, 12);
  assert.equal(result.lessons.find((item) => item.date === '2026-10-12' && item.lessonNumber === 5).subject, 'Теория публичного администрирования');
  assert.equal(result.lessons.some((item) => item.date === '2026-10-17'), false);
});
test('БГУ: конец семестра ограничивает повторяющиеся занятия', () => {
  const result = parseSchedule(html, { week: new Date('2026-12-07T00:00:00Z') });
  assert.ok(result.lessons.every((item) => item.date <= '2026-12-08'));
  assert.equal(parseSchedule(html, { week: new Date('2026-12-14T00:00:00Z') }).lessons.length, 0);
});
test('БГУ: живая облегчённая страница и сохранённая основная страница дают одинаковые пары', async () => {
  const live = await fixture('telek-gmu-25-1.html');
  for (const week of [evenWeek, oddWeek]) {
    assert.deepEqual(parseSchedule(live, { week, groupId: 32982 }), parseSchedule(html, { week, groupId: 32982 }));
  }
});
test('БГУ: настоящая сессия ЗНБ содержит датированные экзамены и зачёты без повторения по неделям', async () => {
  const session = await fixture('telek-znb-23-1.html');
  const prior = parseSchedule(session, { week: oddWeek, groupId: 32143 }).lessons;
  assert.equal(prior.find((item) => item.subject === 'Криминалистика' && item.lessonType === 'экзамен').date, '2026-10-12');
  const current = parseSchedule(session, { week: evenWeek, groupId: 32143 }).lessons;
  assert.equal(current.find((item) => item.subject === 'Финансовое право').lessonType, 'зачёт');
  assert.ok(current.every((item) => item.date >= '2026-10-19' && item.date <= '2026-10-25'));
  assert.equal(current.some((item) => item.lessonType === 'экзамен'), false);
  assert.equal(parseSchedule(session, { week: new Date('2026-11-02T00:00Z'), groupId: 32143 }).lessons.length, 0);
});
test('БГУ: настоящая таблица преподавателя из HTTP и Safari, группы и аудитории', async () => {
  const options = { week: evenWeek, teacherId: 10165 };
  const live = parseSchedule(await fixture('telek-teacher-10165.html'), options);
  const saved = parseSchedule(await fixture('teacher-10165-working.html'), options);
  assert.deepEqual(live.lessons, saved.lessons);
  assert.equal(live.lessons.length, 8);
  assert.equal(live.weekEven, true);
  const credit = live.lessons.find((item) => item.lessonType === 'зачёт');
  assert.equal(credit.date, '2026-10-20');
  assert.deepEqual(credit.groupIds, [32143, 32147, 32190, 32568]);
  assert.deepEqual(credit.auditories, ['4-402']);
  assert.deepEqual(credit.teachers, ['Хаитов Григорий Александрович']);
  assert.deepEqual(live.lessons[0].groups, ['ГМУ-25-1']);
});
test('БГУ: кэш преподавателя разделяет недели и сохраняет исходную неделю при ошибке', async (t) => {
  const cacheDir = await temporary(t), calls = [];
  const provider = new BguProvider({ cacheDir, intervalMs: 0, fetcher: async (url) => {
    calls.push(String(url));
    return { ok: true, text: () => fixture(String(url).includes('26.10.2026') ? 'telek-teacher-10165-next.html' : 'telek-teacher-10165.html') };
  } });
  const nextWeek = new Date('2026-10-26T00:00Z');
  const first = await provider.teacherSchedule(10165, { week: evenWeek, fresh: true });
  const next = await provider.teacherSchedule(10165, { week: nextWeek, fresh: true });
  assert.equal(first.lessons.length, 8); assert.equal(next.lessons.length, 13);
  assert.equal(next.weekEven, false);
  assert.equal((await provider.teacherSchedule(10165, { week: evenWeek })).lessons.length, 8);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).pathname, '/telek/timetable-pps.aspx');
  const offline = new BguProvider({ cacheDir, intervalMs: 0, ttlMs: 0, fetcher: async () => { throw new Error('offline'); } });
  const cached = await offline.teacherSchedule(10165, { week: nextWeek, fresh: true });
  assert.equal(cached.updatedAt, next.updatedAt); assert.equal(cached.stale, true); assert.equal(cached.lessons.length, 13);
});
test('БГУ: ответ преподавателя с чужой неделей отклоняется', async () => {
  const response = await fixture('telek-teacher-10165.html');
  assert.throws(() => parseSchedule(response, { teacherId: 10165, week: new Date('2026-10-26T00:00Z') }), /bgu_teacher_week_mismatch/);
  const broken = response.replace('19.10.2026<br', 'неизвестная дата<br');
  assert.throws(() => parseSchedule(broken, { teacherId: 10165, week: evenWeek }), /bgu_teacher_dates_unrecognized/);
});
test('БГУ: проверены другие реальные группы и общий адрес загрузки', async (t) => {
  for (const [name, count] of [['telek-bi-26-1.html', 19], ['telek-f-25-1.html', 15], ['telek-l-25-1.html', 18], ['telek-l-26-1.html', 16]]) {
    assert.equal(parseSchedule(await fixture(name), { week: evenWeek }).lessons.length, count);
  }
  const provider = new BguProvider({ cacheDir: await temporary(t), intervalMs: 0, fetcher: async (url) => {
    assert.equal(new URL(url).pathname, '/telek/timetable.aspx');
    assert.equal(new URL(url).searchParams.get('idg'), '33340');
    return { ok: true, text: () => fixture('telek-bi-26-1.html') };
  } });
  const result = await provider.groupSchedule(33340, { week: evenWeek, fresh: true });
  assert.equal(result.stale, false); assert.equal(result.lessons.length, 19);
});
test('HTTP БГУ: настоящие сессия и преподаватель нормализованы с часовым поясом и составными id', async (t) => {
  const provider = new BguProvider({ cacheDir: await temporary(t), intervalMs: 0, fetcher: async (url) => ({ ok: true,
    text: () => fixture(String(url).includes('timetable-pps') ? 'telek-teacher-10165.html' : 'telek-znb-23-1.html') }) });
  const server = createHttpServer({ service: new UniversityService({ bgu: provider }), apiAccessKey: 'test-key' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (kind, id) => fetch(`${base}/api/schedule/${kind}/bgu~${id}?week=2026-10-19`, { headers: { Authorization: 'Bearer test-key' } });
  const session = await get('group', 32143); assert.equal(session.status, 200);
  const s = await session.json(); assert.equal(s.timeZone, 'Asia/Irkutsk'); assert.equal(s.stale, false);
  assert.equal(s.lessons.find((item) => item.subject === 'Финансовое право').lessonType, 'зачёт');
  const teacher = await get('teacher', 10165); assert.equal(teacher.status, 200);
  const body = await teacher.json(); assert.equal(body.entityId, 'bgu~10165');
  assert.deepEqual(body.lessons[0].groupIds, ['bgu~32982']);
  assert.equal(body.lessons[0].startsAt, '2026-10-19T06:00:00.000Z');
  assert.equal((await get('auditory', 1)).status, 501);
});
test('БГУ: подгруппа распознаётся в контролируемом варианте реальной разметки', () => {
  // Подгрупп нет в сохранённой группе. Это явно синтетическая вариация настоящей строки.
  const variant = html.replace('>Конституционное право</span>', '>Конституционное право (1 подгруппа)</span>');
  assert.equal(parseSchedule(variant, { week: evenWeek }).lessons[0].subgroup, 1);
});
test('БГУ: недоступность и неизвестная разметка не превращаются в пустую неделю', async () => {
  for (const name of ['group-32988-unavailable.html', 'group-33340-unavailable.html', 'gmu-25-1-unavailable.html']) {
    const response = await fixture(name);
    assert.throws(() => parseSchedule(response), /bgu_temporarily_unavailable/);
  }
  assert.throws(() => parseSchedule('<html>technical error</html>'), /bgu_schedule_unrecognized/);
});
test('БГУ: кэш переживает перезапуск и отказ источника; время не обновляется', async (t) => {
  const cacheDir = await temporary(t);
  let calls = 0;
  const fetcher = async () => { calls += 1; return { ok: true, text: async () => html }; };
  const first = new BguProvider({ cacheDir, intervalMs: 0, ttlMs: 0, fetcher });
  const saved = await first.groupSchedule(32982, { week: evenWeek, fresh: true });
  const second = new BguProvider({ cacheDir, intervalMs: 0, ttlMs: 0, fetcher: async () => ({ ok: true, text: () => fixture('gmu-25-1-unavailable.html') }) });
  const cached = await second.groupSchedule(32982, { week: oddWeek, fresh: true });
  assert.equal(calls, 1);
  assert.equal(cached.updatedAt, saved.updatedAt);
  assert.equal(cached.lessons.length, 12);
  assert.equal(cached.stale, true);
});
test('БГУ: одинаковый HTML семестра не запрашивается отдельно для каждой недели', async (t) => {
  let calls = 0;
  const provider = new BguProvider({ cacheDir: await temporary(t), intervalMs: 0, fetcher: async () => { calls += 1; return { ok: true, text: async () => html }; } });
  await Promise.all([provider.groupSchedule(33340, { week: evenWeek, fresh: true }), provider.groupSchedule(33340, { week: oddWeek, fresh: true })]);
  assert.equal(calls, 1);
});
test('БГУ: общая очередь ограничивает одновременно выполняемые запросы', async (t) => {
  const cacheDir = await temporary(t); let active = 0, maximum = 0;
  const fetcher = async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return { ok: true, text: async () => html }; };
  const a = new BguProvider({ cacheDir, intervalMs: 0, fetcher });
  const b = new BguProvider({ cacheDir, intervalMs: 0, fetcher });
  await Promise.all([a.groupSchedule(11), b.groupSchedule(12), a.groupSchedule(13)]);
  assert.equal(maximum, 1);
});
test('миграция профилей и чатов идемпотентна и сохраняет данные', async (t) => {
  const { dir } = await stores(t);
  const prefsPath = join(dir, 'legacy-prefs.json'), communityPath = join(dir, 'legacy-community.json');
  await writeFile(prefsPath, JSON.stringify({ 1: { selection: { kind: 'group', id: 11, title: 'Группа' }, homeworkReminders: { '2026-10-19:1:0': { at: '2026-10-19T00:00Z' } }, name: 'Имя' } }));
  await writeFile(communityPath, JSON.stringify({ chats: { '-1': { group: { id: 11 }, headman: { userId: 1 } } }, homework: [{ id: 'hw', groupId: 11, lessonDate: '2026-10-19', lessonNumber: 1, text: 'Задачи' }], customMetadata: 'сохранить' }));
  const prefs = new PreferencesStore(prefsPath), community = new CommunityStore(communityPath);
  const profiles = await Promise.all([prefs.get(1), prefs.get(1)]);
  assert.equal(profiles[0].selection.id, 'irnitu~11');
  assert.equal(profiles[1].name, 'Имя');
  assert.equal((await community.getChat(-1)).group.id, 'irnitu~11');
  assert.equal((await community.homeworkForGroup('irnitu~11', { from: '2026-10-19' }))[0].text, 'Задачи');
  assert.equal(JSON.parse(await readFile(communityPath, 'utf8')).customMetadata, 'сохранить');
  const before = await readFile(prefsPath, 'utf8');
  await new PreferencesStore(prefsPath).get(1);
  assert.equal(await readFile(prefsPath, 'utf8'), before);
  assert.equal(JSON.parse(before).schemaVersion, 3);
});
test('одинаковые id разных вузов изолируют ДЗ, личные версии, роли и отметки', async (t) => {
  const { community } = await stores(t);
  await community.setChat(-1, { group: { id: 'irnitu~11' }, headman: { userId: 1 } });
  await community.setChat(-2, { group: { id: 'bgu~11' }, headman: { userId: 2 } });
  for (const groupId of ['irnitu~11', 'bgu~11']) {
    await community.upsertHomework({ groupId, lessonDate: '2026-10-19', lessonNumber: 1, text: groupId });
    await community.setPersonalHomework(3, { groupId, lessonDate: '2026-10-19', lessonNumber: 1, text: `Личное ${groupId}` });
  }
  await community.saveLessonChange({ id: 'move', groupId: 'bgu~11', status: 'pending' });
  assert.equal(await community.homeworkRoleForGroup('irnitu~11', 2), 'student');
  assert.equal((await community.homeworkForUser('bgu~11', 3, { from: '2026-10-19' }))[0].text, 'Личное bgu~11');
  assert.equal((await community.lessonChanges('irnitu~11')).length, 0);
  assert.equal((await community.chatsForGroup(11))[0].group.id, 'irnitu~11');
});
test('фасад провайдеров разделяет одинаковые source id, добавляет моменты и возможности', async () => {
  const provider = (name) => ({ groups: async () => [{ id: 11, title: name }], groupSchedule: async () => ({ lessons: [lesson()], weekEven: true, period: { from: evenWeek, to: evenWeek } }) });
  const service = new UniversityService({ irnitu: provider('ИРНИТУ'), bgu: provider('БГУ') });
  assert.equal((await service.groups('bgu'))[0].id, 'bgu~11');
  assert.equal((await service.groupSchedule(11, { week: evenWeek })).entityId, 'irnitu~11');
  assert.equal((await service.groupSchedule('bgu~11', { week: evenWeek })).lessons[0].startsAt, '2026-10-19T00:15:00.000Z');
  assert.equal(service.universities().find((item) => item.id === 'bgu').capabilities.auditories, false);
});
test('Москва: 08:15 в Иркутске показывается как 03:15; ключ даты вуза сохранён', () => {
  const value = lessonMoments(lesson());
  const local = lessonInTimeZone(value, 'Europe/Moscow');
  assert.equal(local.time, '03:15–04:45');
  assert.equal(local.universityDate, '2026-10-19');
  const yesterday = lessonInTimeZone(lessonMoments(lesson('2026-10-19', '01:15–02:45')), 'Europe/Moscow');
  assert.equal(yesterday.date, '2026-10-18');
  assert.equal(yesterday.universityDate, '2026-10-19');
  assert.equal(zonedDateKey(new Date('2026-10-18T18:00Z'), 'Asia/Irkutsk'), '2026-10-19');
});
test('IANA учитывает сезонное смещение, несуществующее местное время отвергается', () => {
  assert.equal(zonedMoment('2026-07-01', '12:00', 'Europe/Berlin').toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(zonedMoment('2026-12-01', '12:00', 'Europe/Berlin').toISOString(), '2026-12-01T11:00:00.000Z');
  assert.throws(() => zonedMoment('2026-03-29', '02:30', 'Europe/Berlin'), /nonexistent_local_time/);
});
test('тихие часы считаются по профилю, включая переход полуночи', () => {
  const prefs = { timeZone: 'Europe/Moscow', quietHours: { from: '23:00', to: '07:00' } };
  assert.equal(isQuiet(prefs, new Date('2026-10-18T21:00Z')), true);
  assert.equal(isQuiet(prefs, new Date('2026-10-19T05:00Z')), false);
});
test('профиль принимает БГУ и IANA, отвергает неизвестный пояс', async (t) => {
  const { preferences } = await stores(t);
  const service = { groups: async (universityId) => [{ id: `${universityId}~11`, title: 'Группа' }] };
  const input = { user: { id: 1 }, service, preferences };
  await updateMe({ ...input, body: { groupId: 'bgu~11', timeZone: 'Europe/Moscow' } });
  assert.equal((await preferences.get(1)).selection.id, 'bgu~11');
  assert.equal((await preferences.get(1)).timeZone, 'Europe/Moscow');
  await assert.rejects(updateMe({ ...input, body: { timeZone: 'Mars/Olympus' } }), /Неизвестный часовой пояс/);
});
test('московская сводка БГУ приходит в 20:00 Москвы, не в 20:00 Иркутска', async (t) => {
  const { preferences, community, dir } = await stores(t); const sent = [];
  await preferences.set(1, { selection: { kind: 'group', id: 'bgu~11' }, timeZone: 'Europe/Moscow' });
  const service = { groupSchedule: async () => ({ lessons: [lesson('2026-10-19')] }) };
  let now = new Date('2026-10-18T12:00Z');
  const notifications = new NotificationService({ bot: { api: { sendMessageToUser: async (...args) => sent.push(args) } }, service, preferences, community, snapshotsPath: join(dir, 'snapshots.json'), now: () => now });
  assert.equal(await notifications.sendSummaries(), 0);
  now = new Date('2026-10-18T17:00Z');
  assert.equal(await notifications.sendSummaries(), 1);
  assert.match(sent[0][1], /03:15/);
  assert.equal(await notifications.sendSummaries(), 0);
});
test('напоминание БГУ за 10 минут использует момент пары и часовой пояс профиля', async (t) => {
  const { preferences } = await stores(t); const sent = [];
  await preferences.set(1, { selection: { kind: 'group', id: 'bgu~11' }, timeZone: 'Europe/Moscow', reminderMinutes: 10 });
  const reminders = new ReminderService({ preferences, service: { groupSchedule: async () => ({ lessons: [lesson()] }) },
    now: () => new Date('2026-10-19T00:05Z'), bot: { api: { sendMessageToUser: async (...args) => sent.push(args) } } });
  assert.equal(await reminders.check(), 1); assert.match(sent[0][1], /03:15/);
  assert.equal(await reminders.check(), 0);
});
test('день пользователя включает раннюю пару следующей даты вуза', async () => {
  const lessons = await userDayLessons({ groupSchedule: async () => ({ lessons: [lesson('2026-10-19', '01:15–02:45')] }) }, 'bgu~11', '2026-10-18', 'Europe/Moscow');
  assert.equal(lessons.length, 1); assert.equal(lessons[0].date, '2026-10-19');
});
test('московский день и сводка БГУ сохраняют одновременные занятия с разными преподавателями', async () => {
  const response = await fixture('telek-bi-26-1.html');
  const service = { groupSchedule: async (_id, { week }) => ({ lessons: parseSchedule(response, { week, groupId: 33340 }).lessons.map((item) => lessonMoments(item)) }) };
  const lessons = await userDayLessons(service, 'bgu~33340', '2026-10-19', 'Europe/Moscow', null, '2026-10-25');
  assert.equal(lessons.length, 19);
  assert.deepEqual(lessons.filter((item) => item.date === '2026-10-19' && item.subject === 'История России').map((item) => item.teachers[0]),
    ['Синиченко Владимир Викторович', 'Ларионова Татьяна Андреевна']);
});
test('поиск преподавателя в боте учитывает переход пользовательской даты между неделями', async () => {
  const calls = [];
  const service = { teacherSchedule: async (_id, { week }) => {
    calls.push(week.toISOString().slice(0, 10));
    return { lessons: [lessonMoments(lesson('2026-10-19', '01:15–02:45'))] };
  } };
  const lessons = await userDayLessons(service, 'bgu~10165', '2026-10-18', 'Europe/Moscow', null, '2026-10-18', 'teacher');
  assert.equal(lessons.length, 1); assert.deepEqual(calls, ['2026-10-12', '2026-10-19']);
});
test('перенос БГУ сохраняет ДЗ и напоминание; ИРНИТУ с тем же id не меняется', async (t) => {
  const { community, preferences } = await stores(t); const sent = [];
  for (const groupId of ['irnitu~11', 'bgu~11']) await community.upsertHomework({ groupId, lessonDate: '2026-10-19', lessonNumber: 1, text: groupId });
  await community.setChat(-1, { group: { id: 'bgu~11' }, headman: { userId: 1 } });
  await preferences.set(2, { selection: { kind: 'group', id: 'bgu~11' }, homeworkReminders: { '2026-10-19:1:0': { mode: 'lesson', minutesBefore: 10, at: '2026-10-19T00:05Z' } } });
  const from = lesson(), to = lesson('2026-10-20');
  const changes = new LessonChangeService({ community, preferences, service: { groupSchedule: async () => ({ lessons: [from, to] }) }, now: () => new Date('2026-10-18T00:00Z'), bot: { api: { sendMessageToChat: async (...args) => sent.push(args) } } });
  await changes.manual({ groupId: 'bgu~11', user: { id: 1 }, from, to });
  assert.equal((await community.homeworkForGroup('bgu~11', { from: '2026-10-19' }))[0].lessonDate, '2026-10-20');
  assert.equal((await community.homeworkForGroup('irnitu~11', { from: '2026-10-19' }))[0].lessonDate, '2026-10-19');
  assert.equal((await preferences.get(2)).homeworkReminders['2026-10-20:1:0'].at, '2026-10-20T00:05:00.000Z');
  assert.equal(sent.length, 1);
});
test('старые числовые ссылки относятся только к ИРНИТУ', () => {
  assert.equal(groupKey(11), 'irnitu~11'); assert.equal(sameGroup(11, 'irnitu~11'), true); assert.equal(sameGroup(11, 'bgu~11'), false);
  assert.throws(() => groupKey('../11'), /invalid_group_id/);
});


test('БГУ: сессия с конкретной датой в контролируемом варианте таблицы', () => {
  // В рабочем архиве пока только занятия семестра; вариант проверяет ветку датированной сессии.
  const variant = html.replace('>ПОНЕДЕЛЬНИК</td>', '>19.10.2026</td>').replace('>лекция</span>', '>Экзамен</span>');
  const result = parseSchedule(variant, { week: evenWeek, groupId: 32982 });
  assert.equal(result.lessons[0].lessonType, 'экзамен');
  assert.equal(result.lessons[0].date, '2026-10-19');
});
test('БГУ: ошибка обновления не вызывает ложную отмену и не меняет ДЗ', async (t) => {
  const { preferences, community, dir } = await stores(t);
  let stale = false; const sent = [];
  await preferences.set(1, { selection: { kind: 'group', id: 'bgu~11', title: 'Группа' } });
  await community.upsertHomework({ groupId: 'bgu~11', lessonDate: '2026-10-19', lessonNumber: 1, text: 'Сохранить' });
  const service = { groupSchedule: async () => ({ stale, lessons: stale ? [] : [lesson()] }) };
  const notifications = new NotificationService({ service, preferences, community, snapshotsPath: join(dir, 'snapshots.json'), now: () => new Date('2026-10-18T00:00Z'), bot: { api: { sendMessageToUser: async (...args) => sent.push(args) } } });
  await notifications.checkChanges();
  stale = true;
  await notifications.checkChanges();
  assert.equal(sent.length, 0);
  assert.equal((await community.homeworkForGroup('bgu~11', { from: '2026-10-19' }))[0].status, 'active');
});
test('БГУ: поиск групп через провайдер терпит пробелы, регистр и дефисы', async (t) => {
  const provider = new BguProvider({ cacheDir: await temporary(t), intervalMs: 0, fetcher: async () => ({ ok: true, text: () => fixture('groups.html') }) });
  assert.equal((await provider.searchGroups('гму 25 1'))[0].id, 32982);
});
