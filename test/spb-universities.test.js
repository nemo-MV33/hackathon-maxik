import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpbpuProvider, normalizeSpbpuWeek } from '../src/universities/spbpu/provider.js';
import { SpbuProvider, normalizeSpbuWeek, spbuCourse } from '../src/universities/spbu/provider.js';
import { JsonSource, slotNumber } from '../src/universities/json-source.js';
import { UniversityService } from '../src/universities/service.js';
import { groupKey, splitGroupKey } from '../src/universities/identity.js';
import { universities } from '../src/universities/config.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const week = new Date('2026-10-19T00:00:00Z');
const temporary = async (t) => { const dir = await mkdtemp(join(tmpdir(), 'norfly-spb-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

// Ответы сохранены с ruz.spbstu.ru и timetable.spbu.ru 19.10.2026.
const spbpuFetcher = async (url) => {
  const path = new URL(url).pathname.replace('/api/v1/ruz/', '');
  if (path === 'faculties') return json(await fixture('spbpu/faculties.json'));
  if (path === 'faculties/125/groups') return json(await fixture('spbpu/groups-125.json'));
  if (path.startsWith('faculties/')) return json({ groups: [] });
  if (path === 'scheduler/45680') return json(await fixture('spbpu/scheduler-45680-2026-10-19.json'));
  return json({ error: 'not found' }, 404);
};

test('Вузы: у каждого подключённого вуза свой часовой пояс, источник и сетка звонков', () => {
  assert.deepEqual(universities.map((item) => item.id), ['irnitu', 'bgu', 'spbpu', 'spbu']);
  for (const item of universities) {
    assert.ok(item.timeZone && item.source && Object.keys(item.lessonTimes).length >= 6, item.id);
  }
  assert.equal(groupKey('45680', 'spbpu'), 'spbpu~45680');
  assert.deepEqual(splitGroupKey('spbu~474610'), { universityId: 'spbu', sourceId: 474610 });
  assert.throws(() => groupKey('itmo~1'), /invalid_group_id/);
});

test('Сетка звонков: известное начало даёт номер пары, нестандартное — устойчивый номер после всех слотов', () => {
  const times = { 1: '08:00–09:40', 2: '10:00–11:40' };
  assert.equal(slotNumber(times, '10:00'), 2);
  assert.equal(slotNumber(times, '09:25'), 1000 + 9 * 60 + 25);
});

test('СПбПУ: неделя группы из настоящего ответа API — время, тип, корпус и ссылка на курс', () => {
  return fixture('spbpu/scheduler-45680-2026-10-19.json').then((payload) => {
    const result = normalizeSpbpuWeek(payload, { week, groupId: 45680 });
    assert.equal(result.weekEven, true);
    assert.equal(result.lessons.length, 11);
    const first = result.lessons[0];
    assert.equal(first.date, '2026-10-20');
    assert.equal(first.time, '10:00–11:40');
    assert.equal(first.lessonNumber, 2);
    assert.equal(first.lessonType, 'практика');
    assert.deepEqual(first.auditories, ['215, 11 к.']);
    assert.equal(first.building, '11-й учебный корпус');
    assert.match(first.link, /^https:\/\/dl\.spbstu\.ru/);
    assert.ok(result.lessons.some((lesson) => lesson.lessonType === 'лекция'));
    assert.ok(result.lessons.every((lesson) => lesson.date >= '2026-10-19' && lesson.date <= '2026-10-25'));
  });
});

test('СПбПУ: подгруппа из пометки «п/г 01», поток не считается заметкой', () => {
  const lesson = (info) => ({ subject: 'Физика', time_start: '12:00', time_end: '13:40', additional_info: info, typeObj: { name: 'Лабораторные' } });
  const { lessons } = normalizeSpbpuWeek({ week: { is_odd: true }, days: [{ date: '2026-10-21', lessons: [lesson('5130903/30301 п/г 01'), lesson('п/г2'), lesson('Поток')] }] }, { week, groupId: 1 });
  assert.deepEqual(lessons.map((item) => item.subgroup), [1, 2, null]);
  assert.deepEqual(lessons.map((item) => item.comment), ['', '', '']);
  assert.equal(lessons[0].lessonType, 'лабораторная');
});

test('СПбПУ: справочник без архивных копий, институт и курс для выбора группы', async (t) => {
  const provider = new SpbpuProvider({ cacheDir: await temporary(t), fetcher: spbpuFetcher });
  const groups = await provider.groups();
  assert.deepEqual(groups.map((group) => group.title), ['5130903/30301', '5130903/30302', '5130903/30303']);
  assert.equal(groups[0].id, 45680);
  assert.equal(groups[0].course, 4);
  assert.equal(groups[0].institute, 'Институт компьютерных наук и кибербезопасности');
  assert.equal((await provider.searchGroups('5130903 30302'))[0].title, '5130903/30302');
  assert.ok((await provider.institutes()).includes('Институт компьютерных наук и кибербезопасности'));
});

test('СПбПУ: сервис возвращает неделю в часовом поясе Петербурга', async (t) => {
  const service = new UniversityService({ spbpu: new SpbpuProvider({ cacheDir: await temporary(t), fetcher: spbpuFetcher }) });
  const schedule = await service.groupSchedule('spbpu~45680', { week });
  assert.equal(schedule.timeZone, 'Europe/Moscow');
  assert.equal(schedule.lessons[0].startsAt, '2026-10-20T07:00:00.000Z');
  assert.equal(schedule.lessons[0].groupId, 'spbpu~45680');
});

test('СПбПУ: при сбое источника остаётся последнее расписание с исходным временем', async (t) => {
  const cacheDir = await temporary(t);
  let now = Date.parse('2026-10-19T10:00:00Z');
  let down = false;
  const fetcher = async (url) => (down ? json({}, 503) : spbpuFetcher(url));
  const first = await new SpbpuProvider({ cacheDir, fetcher, now: () => now }).groupSchedule(45680, { week });
  down = true;
  now += 3_600_000;
  const second = await new SpbpuProvider({ cacheDir, fetcher, now: () => now }).groupSchedule(45680, { week });
  assert.equal(second.lessons.length, first.lessons.length);
  assert.equal(second.updatedAt, first.updatedAt);
  assert.equal(second.stale, true);
});

test('СПбГУ: неделя группы — параллельные потоки сливаются, должности и адрес отделены', async () => {
  const payload = await fixture('spbu/group-474610-2026-10-19.json');
  const { lessons } = normalizeSpbuWeek(payload.Days, { week, groupId: 474610 });
  const math = lessons.find((lesson) => lesson.subject === 'Электив. Основная траектория. Высшая математика');
  assert.equal(math.lessonType, 'лекция');
  assert.equal(math.time, '11:10–12:45');
  assert.ok(math.teachers.every((name) => !/доцент|преподаватель/.test(name)));
  assert.ok(math.auditories.length > 1);
  assert.equal(math.building, 'Ульяновская улица, д. 3, корп. В, лит. А');
  const keys = lessons.map((lesson) => `${lesson.date}|${lesson.time}|${lesson.subject}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(lessons.every((lesson) => lesson.date >= '2026-10-19' && lesson.date <= '2026-10-25'));
  assert.ok(lessons.some((lesson) => lesson.auditories.includes('онлайн')));
  assert.ok(lessons.every((lesson) => lesson.auditories.every((room) => !/коммуникационных/.test(room))));
});

test('СПбГУ: отменённые занятия не попадают в расписание', () => {
  const event = (cancelled) => ({ Start: '2026-10-20T09:30:00', End: '2026-10-20T11:05:00', Subject: `Право${cancelled ? ' 2' : ''}, лекция`, IsCancelled: cancelled, LocationsDisplayText: '' });
  const { lessons } = normalizeSpbuWeek([{ DayStudyEvents: [event(true), event(false)] }], { week, groupId: 1 });
  assert.deepEqual(lessons.map((lesson) => lesson.subject), ['Право']);
  assert.equal(lessons[0].lessonNumber, 1);
});

test('СПбГУ: курс по году набора в названии группы', () => {
  assert.equal(spbuCourse('25.Б20-фз', new Date('2026-10-19T00:00:00Z')), 2);
  assert.equal(spbuCourse('26.М01-фз', new Date('2026-10-19T00:00:00Z')), 1);
  assert.equal(spbuCourse('26.М01-фз', new Date('2027-03-01T00:00:00Z')), 1);
  assert.equal(spbuCourse('Группа', new Date('2026-10-19T00:00:00Z')), null);
});

// Структура каталога повторяет ответы timetable.spbu.ru: направления → уровни и программы → годы набора → группы.
const spbuFetcher = (calls = []) => async (url) => {
  const path = decodeURIComponent(new URL(url).pathname.replace('/api/v1/', ''));
  calls.push(path);
  if (path === 'study/divisions') return json(await fixture('spbu/divisions.json'));
  if (path === 'study/divisions/PHYS/programs/levels') return json(await fixture('spbu/levels-phys.json'));
  if (path === 'programs/18250/groups') return json(await fixture('spbu/program-18250-groups.json'));
  if (path.startsWith('educators/search/')) return json({ Educators: [{ Id: 2921, DisplayName: 'Слоущ В. А.', FullName: 'Слоущ Владимир Анатольевич' }] });
  if (path.startsWith('groups/474610/events/')) return json(await fixture('spbu/group-474610-2026-10-19.json'));
  return json({}, 404);
};

test('СПбГУ: каталог направление → программа → год → группа, выбранная группа запоминается', async (t) => {
  const calls = [];
  const cacheDir = await temporary(t);
  const now = () => Date.parse('2026-10-19T10:00:00Z');
  const service = new UniversityService({ spbu: new SpbuProvider({ cacheDir, fetcher: spbuFetcher(calls), now }) });
  assert.deepEqual((await service.browse('spbu')).map((item) => item.id), ['MATH', 'PHYS']);
  const programs = await service.browse('spbu', 'PHYS');
  assert.deepEqual(programs.map((item) => [item.title, item.hint]), [['Физика', 'Бакалавриат'], ['Физика конденсированного состояния', 'Магистратура']]);
  // Пустой набор 2026 и выпуск 2018 не показываются: по ним нет действующих групп.
  const years = await service.browse('spbu', `PHYS/${programs[0].id}`);
  assert.deepEqual(years.map((item) => [item.title, item.course]), [['2025', 2], ['2024', 3]]);
  const groups = await service.browse('spbu', `PHYS/${programs[0].id}/18250`);
  assert.deepEqual(groups.map((item) => [item.id, item.title, item.kind, item.course]), [['spbu~474610', '25.Б20-фз', 'group', 2]]);
  assert.equal(await service.hasGroup('spbu~474610'), true);
  assert.equal(await service.hasGroup('spbu~1'), false);
  assert.deepEqual((await service.searchGroups('25б20', { universityId: 'spbu' })).map((group) => group.id), ['spbu~474610']);
  // Повторный проход по каталогу берёт данные из кэша и не тратит квоту.
  const before = calls.length;
  const again = new UniversityService({ spbu: new SpbuProvider({ cacheDir, fetcher: spbuFetcher(calls), now }) });
  await again.browse('spbu', `PHYS/${programs[0].id}/18250`);
  assert.equal(calls.length, before);
  assert.equal(await again.hasGroup('spbu~474610'), true);
});

test('СПбГУ: расписание группы и поиск преподавателя через API', async (t) => {
  const service = new UniversityService({ spbu: new SpbuProvider({ cacheDir: await temporary(t), fetcher: spbuFetcher() }) });
  assert.equal((await service.searchTeachers('Слоущ', { universityId: 'spbu' }))[0].id, 'spbu~2921');
  assert.deepEqual(await service.searchTeachers('Сл', { universityId: 'spbu' }), []);
  const schedule = await service.groupSchedule('spbu~474610', { week });
  assert.equal(schedule.timeZone, 'Europe/Moscow');
  assert.ok(schedule.lessons.length > 10);
});

test('Источник JSON: после долгого 429 запросы не уходят до конца блокировки, кэш остаётся', async (t) => {
  let calls = 0;
  let now = Date.parse('2026-10-19T10:00:00Z');
  let limited = false;
  const fetcher = async () => {
    calls += 1;
    if (limited) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '85096' }), json: async () => ({}) };
    return json({ value: 1 });
  };
  const source = new JsonSource({ id: 'quota', baseUrl: 'https://example.test/', cacheDir: await temporary(t), retries: 3, fetcher, now: () => now });
  assert.deepEqual((await source.get('week', { ttlMs: 1000 })).value, { value: 1 });
  limited = true;
  now += 5_000;
  const cached = await source.get('week', { ttlMs: 1000, fresh: true });
  assert.equal(cached.stale, true);
  assert.equal(calls, 2);
  now += 120_000;
  await assert.rejects(source.get('other', { ttlMs: 1000 }), /quota_temporarily_unavailable/);
  assert.equal(calls, 2);
});

test('Источник JSON: ошибка 4xx не повторяется, 5xx повторяется', async (t) => {
  let calls = 0;
  const source = new JsonSource({ id: 'test', baseUrl: 'https://example.test/', cacheDir: await temporary(t), retries: 2,
    fetcher: async (url) => { calls += 1; return json({}, String(url).endsWith('missing') ? 404 : 503); } });
  await assert.rejects(source.get('missing', { ttlMs: 1000 }), /test_http_404/);
  assert.equal(calls, 1);
  await assert.rejects(source.get('broken', { ttlMs: 1000 }), /test_unavailable/);
  assert.equal(calls, 3);
});
