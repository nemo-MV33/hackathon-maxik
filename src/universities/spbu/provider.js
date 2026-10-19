import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UnsupportedScheduleError } from '../provider.js';
import { addDays, startOfWeek, toDateKey } from '../../lib/date.js';
import { JsonSource, clockTime, compactSearch, normalizeLessonType, slotNumber } from '../json-source.js';

// Основная сетка СПбГУ. У части площадок своё время: такие пары получают номер по началу.
export const spbuLessonTimes = {
  1: '09:30–11:05', 2: '11:15–12:50', 3: '13:40–15:15', 4: '15:25–17:00',
  5: '17:10–18:45', 6: '18:55–20:30',
};

const KNOWN_FILE = 'spbu-groups.json';
// Направления, программы и группы меняются раз в семестр: неделя кэша бережёт суточную квоту API.
const CATALOG_TTL = 7 * 24 * 3_600_000;

// Курс по году набора: учебный год начинается 1 сентября.
export const courseFromYear = (year, today = new Date()) => {
  const academicYear = today.getUTCFullYear() - (today.getUTCMonth() < 8 ? 1 : 0);
  const course = academicYear - year + 1;
  return course >= 1 && course <= 6 ? course : null;
};

// «25.Б20-фз»: первые две цифры — год набора.
export const spbuCourse = (title, today = new Date()) => {
  const year = Number(String(title).match(/^(\d{2})\./)?.[1]);
  return year ? courseFromYear(2000 + year, today) : null;
};

// «Иванов И. И., доцент; Петров П. П., ассистент» → фамилии с инициалами без должностей.
const teachersOf = (text) => String(text ?? '').split(';').map((item) => item.split(',')[0].trim()).filter(Boolean);

// «Ульяновская улица, д. 3, корп. В, лит. А, 312» → аудитория «312» и адрес отдельно.
const placeOf = (text) => {
  const value = String(text ?? '').trim();
  // Дистанционные занятия источник подписывает длинной фразой вместо аудитории.
  if (/информационно-коммуникационных|дистанционн|онлайн/i.test(value)) return { room: 'онлайн', address: '' };
  const cut = value.lastIndexOf(',');
  if (cut < 0) return { room: value, address: '' };
  return { room: value.slice(cut + 1).trim(), address: value.slice(0, cut).trim() };
};

const subjectOf = (text) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = value.lastIndexOf(', ');
  if (cut < 0) return { subject: value, kind: '' };
  return { subject: value.slice(0, cut), kind: value.slice(cut + 2) };
};

export const normalizeSpbuWeek = (days, { week, groupId, teacherId } = {}) => {
  if (!Array.isArray(days)) throw new Error('spbu_schedule_unrecognized');
  const from = toDateKey(startOfWeek(week));
  const to = toDateKey(addDays(startOfWeek(week), 6));
  const merged = new Map();
  for (const day of days) {
    for (const event of day.DayStudyEvents ?? []) {
      const date = String(event.Start ?? '').slice(0, 10);
      const start = clockTime(String(event.Start ?? '').slice(11));
      const end = clockTime(String(event.End ?? '').slice(11));
      if (event.IsCancelled || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to || !start || !end) continue;
      const { subject, kind } = subjectOf(event.Subject);
      if (!subject) continue;
      const places = (event.EventLocations?.length ? event.EventLocations.map((item) => item.DisplayName) : [event.LocationsDisplayText])
        .map(placeOf).filter((place) => place.room);
      // Параллельные потоки одного предмета (например, английский по уровням) — одна пара с несколькими аудиториями.
      const key = `${date}|${start}|${end}|${subject}|${kind}`;
      const current = merged.get(key);
      if (current) {
        current.teachers = [...new Set([...current.teachers, ...teachersOf(event.EducatorsDisplayText)])];
        current.auditories = [...new Set([...current.auditories, ...places.map((place) => place.room)])];
        continue;
      }
      const lessonNumber = slotNumber(spbuLessonTimes, start);
      merged.set(key, {
        id: `${groupId ?? teacherId}:${date}:${lessonNumber}:0:${merged.size}`,
        date, lessonNumber, time: `${start}–${end}`, subject, lessonType: normalizeLessonType(kind),
        subgroup: null, teachers: teachersOf(event.EducatorsDisplayText), teacherIds: teacherId ? [teacherId] : [],
        auditories: places.map((place) => place.room), auditoryIds: [],
        building: [...new Set(places.map((place) => place.address).filter(Boolean))].join('; '),
        groups: String(event.ContingentUnitName ?? '').split(',').map((name) => name.trim()).filter(Boolean), groupIds: groupId ? [groupId] : [],
        comment: '', link: '', sourceType: 'spbu_api', transferred: false,
      });
    }
  }
  return { weekEven: null, lessons: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber) };
};

// Расписание СПбГУ: открытый API timetable.spbu.ru с суточной квотой на IP.
// Поиска групп по названию в API нет, а полный обход — 3,5 тыс. запросов и блокировка на сутки.
// Поэтому группа выбирается как на сайте вуза: направление → программа → год набора → группа.
// Группы, открытые в каталоге, запоминаются: по ним работают поиск, бот и проверка ссылок.
export class SpbuProvider {
  #known = null;

  constructor({ cacheDir = './data/spbu-cache', ttlMs = 3_600_000, fetcher, now = Date.now } = {}) {
    this.source = new JsonSource({ id: 'spbu', baseUrl: 'https://timetable.spbu.ru/api/v1/', cacheDir, concurrency: 2, intervalMs: 250, timeoutMs: 40_000, retries: 3, fetcher, now });
    Object.assign(this, { cacheDir, ttlMs, now });
  }

  async #knownGroups() {
    if (this.#known) return this.#known;
    try { this.#known = new Map(JSON.parse(await readFile(join(this.cacheDir, KNOWN_FILE), 'utf8')).map((group) => [group.id, group])); }
    catch { this.#known = new Map(); }
    return this.#known;
  }

  async #remember(groups) {
    const known = await this.#knownGroups();
    for (const group of groups) known.set(group.id, group);
    await mkdir(this.cacheDir, { recursive: true });
    const temporary = join(this.cacheDir, `${KNOWN_FILE}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify([...known.values()]));
    await rename(temporary, join(this.cacheDir, KNOWN_FILE));
  }

  async #catalog(path) { return (await this.source.get(path, { ttlMs: CATALOG_TTL })).value; }

  // Каталог: '' — направления, 'PHYS' — программы, 'PHYS/<программа>' — годы набора, 'PHYS/<программа>/<id>' — группы.
  async browse(path = '') {
    const [alias, program, yearId] = String(path).split('/').filter(Boolean);
    const divisions = await this.#catalog('study/divisions');
    if (!alias) return divisions.map((item) => ({ id: item.Alias, title: item.Name, kind: 'node' })).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    const division = divisions.find((item) => item.Alias === alias);
    if (!division) throw new Error('spbu_division_not_found');
    const levels = await this.#catalog(`study/divisions/${encodeURIComponent(alias)}/programs/levels`);
    const today = new Date(this.now());
    const programs = levels.flatMap((level) => level.StudyProgramCombinations.map((item, index) => ({
      id: `${level.StudyLevelName}~${index}`, title: item.Name, hint: level.StudyLevelName,
      years: item.AdmissionYears.filter((year) => !year.IsEmpty && courseFromYear(year.YearNumber, today)),
    }))).filter((item) => item.years.length);
    if (!program) return programs.map(({ years, ...item }) => ({ ...item, kind: 'node' }));
    const selected = programs.find((item) => item.id === decodeURIComponent(program));
    if (!selected) throw new Error('spbu_program_not_found');
    if (!yearId) {
      return selected.years.sort((a, b) => b.YearNumber - a.YearNumber).map((year) => ({
        id: String(year.StudyProgramId), title: String(year.YearNumber), course: courseFromYear(year.YearNumber, today), kind: 'node',
      }));
    }
    const year = selected.years.find((item) => String(item.StudyProgramId) === yearId);
    if (!year) throw new Error('spbu_year_not_found');
    const groups = ((await this.#catalog(`programs/${year.StudyProgramId}/groups`)).Groups ?? [])
      .map((group) => ({ id: Number(group.StudentGroupId), title: String(group.StudentGroupName).trim(), institute: division.Name, program: selected.title }))
      .filter((group) => group.id > 0 && group.title);
    await this.#remember(groups);
    return groups.map((group) => ({ ...group, course: spbuCourse(group.title, today), kind: 'group' }));
  }

  async hasGroup(id) { return (await this.#knownGroups()).has(Number(id)); }

  async groups() {
    const today = new Date(this.now());
    return [...(await this.#knownGroups()).values()].map((group) => ({ ...group, course: spbuCourse(group.title, today) }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  async institutes() { return []; }

  async searchGroups(query, { limit = 10 } = {}) {
    const needle = compactSearch(query);
    return (await this.groups()).filter((group) => !needle || compactSearch(group.title).includes(needle)).slice(0, limit);
  }

  // Справочника преподавателей у СПбГУ нет, только поиск по фамилии.
  async teachers() { return []; }
  async searchTeachers(query, { limit = 10 } = {}) {
    const text = String(query ?? '').trim();
    if (text.length < 3) return [];
    const { value } = await this.source.get(`educators/search/${encodeURIComponent(text)}`, { ttlMs: CATALOG_TTL });
    return (value.Educators ?? []).map((item) => ({ id: Number(item.Id), name: item.DisplayName, fullName: item.FullName || item.DisplayName }))
      .filter((item) => item.id > 0).slice(0, limit);
  }

  async auditories() { return []; }
  async searchAuditories() { return []; }
  async auditorySchedule() { throw new UnsupportedScheduleError(); }

  async #week(kind, path, id, { week = new Date(), fresh = false } = {}) {
    const from = startOfWeek(week);
    const entry = await this.source.get(`${path}/events/${toDateKey(from)}/${toDateKey(addDays(from, 7))}`, { ttlMs: this.ttlMs, fresh });
    const days = kind === 'group' ? entry.value.Days : entry.value.EducatorEventsDays;
    return { kind, entityId: id, period: { from, to: addDays(from, 6) }, ...normalizeSpbuWeek(days ?? [], { week: from, [`${kind}Id`]: id }),
      stale: entry.stale, updatedAt: new Date(entry.savedAt).toISOString() };
  }

  groupSchedule(id, options) { return this.#week('group', `groups/${id}`, id, options); }
  teacherSchedule(id, options) { return this.#week('teacher', `educators/${id}`, id, options); }
}
