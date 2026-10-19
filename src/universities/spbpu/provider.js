import { UnsupportedScheduleError } from '../provider.js';
import { addDays, startOfWeek, toDateKey } from '../../lib/date.js';
import { JsonSource, clockTime, compactSearch, normalizeLessonType, slotNumber } from '../json-source.js';

// Звонки СПбПУ по данным ruz.spbstu.ru: пара 100 минут, перерыв 20.
export const spbpuLessonTimes = {
  1: '08:00–09:40', 2: '10:00–11:40', 3: '12:00–13:40', 4: '14:00–15:40',
  5: '16:00–17:40', 6: '18:00–19:40', 7: '20:00–21:40',
};

// «5130903/30301_2025» — архивная копия группы прошлого года, у живой группы суффикса нет.
const displayName = (name) => String(name ?? '').replace(/_\d{4}$/, '').trim();
const subgroupOf = (info) => Number(String(info ?? '').match(/п\/г\s*0?([12])\b/i)?.[1]) || null;
const roomTitle = (auditory) => [auditory.name, auditory.building?.abbr].filter(Boolean).join(', ');

export const normalizeSpbpuWeek = (payload, { week, groupId, teacherId, auditoryId } = {}) => {
  const from = toDateKey(startOfWeek(week));
  const to = toDateKey(addDays(startOfWeek(week), 6));
  if (!payload || !Array.isArray(payload.days)) throw new Error('spbpu_schedule_unrecognized');
  const lessons = [];
  for (const day of payload.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || day.date < from || day.date > to) continue;
    for (const item of day.lessons ?? []) {
      const start = clockTime(item.time_start);
      const end = clockTime(item.time_end);
      const subject = String(item.subject ?? '').replace(/\s+/g, ' ').trim();
      if (!start || !end || !subject) continue;
      const subgroup = subgroupOf(item.additional_info);
      const lessonNumber = slotNumber(spbpuLessonTimes, start);
      const info = String(item.additional_info ?? '').trim();
      lessons.push({
        id: `${groupId ?? teacherId ?? auditoryId}:${day.date}:${lessonNumber}:${subgroup ?? 0}:${lessons.length}`,
        date: day.date, lessonNumber, time: `${start}–${end}`,
        subject, lessonType: normalizeLessonType(item.typeObj?.name),
        subgroup,
        teachers: (item.teachers ?? []).map((teacher) => teacher.full_name).filter(Boolean),
        teacherIds: (item.teachers ?? []).map((teacher) => Number(teacher.id)).filter(Number.isFinite),
        auditories: (item.auditories ?? []).map(roomTitle).filter(Boolean),
        auditoryIds: (item.auditories ?? []).map((auditory) => Number(auditory.id)).filter(Number.isFinite),
        building: [...new Set((item.auditories ?? []).map((auditory) => auditory.building?.name).filter(Boolean))].join(', '),
        groups: (item.groups ?? []).map((group) => displayName(group.name)),
        groupIds: (item.groups ?? []).map((group) => Number(group.id)).filter(Number.isFinite),
        comment: info && !subgroup && info !== 'Поток' ? info : '',
        link: /^https:\/\//.test(item.lms_url ?? '') ? item.lms_url : /^https:\/\//.test(item.webinar_url ?? '') ? item.webinar_url : '',
        sourceType: 'spbpu_api', transferred: false,
      });
    }
  }
  return {
    weekEven: payload.week ? !payload.week.is_odd : null,
    lessons: lessons.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber),
  };
};

// Расписание Политеха: открытый JSON API ruz.spbstu.ru без ключа.
export class SpbpuProvider {
  #rooms = new Map();

  constructor({ cacheDir = './data/spbpu-cache', ttlMs = 900_000, directoryTtlMs = 10_800_000, fetcher, now } = {}) {
    this.source = new JsonSource({ id: 'spbpu', baseUrl: 'https://ruz.spbstu.ru/api/v1/ruz/', cacheDir, concurrency: 3, fetcher, now });
    Object.assign(this, { ttlMs, directoryTtlMs });
  }

  async #directory(path) { return (await this.source.get(path, { ttlMs: this.directoryTtlMs })).value; }

  async faculties() {
    return ((await this.#directory('faculties')).faculties ?? [])
      .map((item) => ({ id: Number(item.id), name: String(item.name ?? '').trim(), abbr: String(item.abbr ?? '').trim() }))
      .filter((item) => item.id > 0 && item.name);
  }

  async institutes() { return (await this.faculties()).map((item) => item.name).sort((a, b) => a.localeCompare(b, 'ru')); }

  async groups() {
    const faculties = await this.faculties();
    const lists = await Promise.all(faculties.map(async (faculty) => ((await this.#directory(`faculties/${faculty.id}/groups`)).groups ?? [])
      .map((group) => ({ ...group, faculty }))));
    // У одной группы бывает архивная копия: оставляем актуальную.
    const best = new Map();
    for (const group of lists.flat()) {
      const title = displayName(group.name);
      if (!title || !Number.isFinite(Number(group.id))) continue;
      const legacy = /_\d{4}$/.test(group.name);
      const current = best.get(title);
      if (!current || (current.legacy && !legacy) || (current.legacy === legacy && Number(group.id) > current.id)) {
        best.set(title, { id: Number(group.id), title, course: Number(group.level) || null, institute: group.faculty.name, legacy });
      }
    }
    return [...best.values()].map(({ legacy, ...group }) => group).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  async searchGroups(query, { institute, course, limit = 10 } = {}) {
    const needle = compactSearch(query);
    return (await this.groups())
      .filter((group) => !institute || group.institute === institute)
      .filter((group) => !course || group.course === Number(course))
      .filter((group) => !needle || compactSearch(group.title).includes(needle))
      .slice(0, limit);
  }

  async teachers() {
    return ((await this.#directory('teachers')).teachers ?? [])
      .map((item) => ({ id: Number(item.id), name: String(item.full_name ?? '').trim(), fullName: String(item.full_name ?? '').trim() }))
      .filter((item) => item.id > 0 && item.fullName)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  }

  async searchTeachers(query, { limit = 10 } = {}) {
    const needle = String(query ?? '').toLowerCase().replace(/ё/g, 'е').trim();
    return (await this.teachers()).filter((item) => item.fullName.toLowerCase().replace(/ё/g, 'е').includes(needle)).slice(0, limit);
  }

  // Аудитории лежат по корпусам: 47 запросов раз в три часа, расписание аудитории требует пару «корпус + номер».
  async auditories() {
    const buildings = (await this.#directory('buildings')).buildings ?? [];
    const lists = await Promise.all(buildings.map(async (building) => ((await this.#directory(`buildings/${building.id}/rooms`).catch(() => ({ rooms: [] }))).rooms ?? [])
      .map((room) => ({ id: Number(room.id), title: [room.name, building.abbr].filter(Boolean).join(', '), buildingId: Number(building.id) }))));
    const rooms = lists.flat().filter((room) => room.id > 0 && room.title);
    for (const room of rooms) this.#rooms.set(room.id, room.buildingId);
    return rooms.sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }));
  }

  async searchAuditories(query, { limit = 10 } = {}) {
    const needle = compactSearch(query);
    return (await this.auditories()).filter((room) => compactSearch(room.title).includes(needle)).slice(0, limit)
      .map(({ buildingId, ...room }) => room);
  }

  async #week(kind, path, id, { week = new Date(), fresh = false } = {}) {
    const from = startOfWeek(week);
    const entry = await this.source.get(`${path}?date=${toDateKey(from)}`, { ttlMs: this.ttlMs, fresh });
    const normalized = normalizeSpbpuWeek(entry.value, { week: from, [`${kind}Id`]: id });
    return { kind, entityId: id, period: { from, to: addDays(from, 6) }, ...normalized,
      stale: entry.stale, updatedAt: new Date(entry.savedAt).toISOString() };
  }

  groupSchedule(id, options) { return this.#week('group', `scheduler/${id}`, id, options); }
  teacherSchedule(id, options) { return this.#week('teacher', `teachers/${id}/scheduler`, id, options); }

  async auditorySchedule(id, options) {
    if (!this.#rooms.has(Number(id))) await this.auditories();
    const building = this.#rooms.get(Number(id));
    if (!building) throw new UnsupportedScheduleError();
    return this.#week('auditory', `buildings/${building}/rooms/${id}/scheduler`, id, options);
  }
}
