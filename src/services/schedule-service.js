import { addDays, endOfWeek, startOfWeek } from '../lib/date.js';
import { normalizeSchedule } from '../irnitu/normalize.js';

const normalizeSearch = (value) => String(value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim();

const includesQuery = (fields, query) => {
  const normalized = normalizeSearch(query);
  return !normalized || fields.some((field) => normalizeSearch(field).includes(normalized));
};

export class ScheduleService {
  #groupsPromise;
  #teachersPromise;
  #auditoriesPromise;

  constructor(client) {
    this.client = client;
  }

  groups() {
    return this.#loadDirectory('groups', () => this.client.groups(), (items) => this.#cleanGroups(items));
  }

  teachers() {
    return this.#loadDirectory('teachers', () => this.client.teachers(), (items) => this.#cleanTeachers(items));
  }

  auditories() {
    return this.#loadDirectory('auditories', () => this.client.auditories(), (items) => this.#cleanAuditories(items));
  }

  async directories() {
    const [groups, teachers, auditories] = await Promise.all([
      this.groups(), this.teachers(), this.auditories(),
    ]);
    return { groups, teachers, auditories };
  }

  async institutes() {
    const groups = await this.groups();
    return [...new Set(groups.map((group) => group.institute))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }

  async searchGroups(query, { institute, course, limit = 10 } = {}) {
    const groups = await this.groups();
    return groups
      .filter((group) => !institute || group.institute === institute)
      .filter((group) => !course || group.course === Number(course))
      .filter((group) => includesQuery([group.title, group.institute], query))
      .slice(0, limit);
  }

  async searchTeachers(query, { limit = 10 } = {}) {
    const teachers = await this.teachers();
    return teachers
      .filter((teacher) => includesQuery([teacher.name, teacher.fullName], query))
      .slice(0, limit);
  }

  async searchAuditories(query, { limit = 10 } = {}) {
    const auditories = await this.auditories();
    return auditories
      .filter((auditory) => includesQuery([auditory.title], query))
      .slice(0, limit);
  }

  groupSchedule(id, { week, subgroup } = {}) {
    return this.#getSchedule('group', id, { week, subgroup, groupId: id });
  }

  teacherSchedule(id, { week } = {}) {
    return this.#getSchedule('teacher', id, { week });
  }

  auditorySchedule(id, { week } = {}) {
    return this.#getSchedule('auditory', id, { week });
  }

  async #getSchedule(kind, id, options) {
    const weekStart = startOfWeek(options.week ?? new Date());
    const weekEnd = endOfWeek(weekStart);
    const [payload, groups, teachers, auditories] = await Promise.all([
      this.client[`${kind}Schedule`](id, weekStart, weekEnd),
      this.groups().catch(() => []),
      this.teachers().catch(() => []),
      this.auditories().catch(() => []),
    ]);
    const dictionaries = {
      groups: new Map(groups.map((item) => [item.id, item.title])),
      teachers: new Map(teachers.map((item) => [item.id, item.fullName || item.name])),
      auditories: new Map(auditories.map((item) => [item.id, item.title])),
    };
    return {
      kind,
      entityId: Number(id),
      period: { from: weekStart, to: addDays(weekStart, 6) },
      ...normalizeSchedule(payload, dictionaries, options),
    };
  }

  #loadDirectory(name, loader, cleaner) {
    const field = `#${name}Promise`;
    const current = name === 'groups'
      ? this.#groupsPromise
      : name === 'teachers' ? this.#teachersPromise : this.#auditoriesPromise;
    if (current) return current;
    const promise = loader().then(cleaner).catch((error) => {
      if (name === 'groups') this.#groupsPromise = undefined;
      else if (name === 'teachers') this.#teachersPromise = undefined;
      else this.#auditoriesPromise = undefined;
      throw error;
    });
    if (field === '#groupsPromise') this.#groupsPromise = promise;
    else if (field === '#teachersPromise') this.#teachersPromise = promise;
    else this.#auditoriesPromise = promise;
    return promise;
  }

  #cleanGroups(items) {
    const unique = new Map();
    for (const item of items) {
      const title = String(item.title ?? '').trim();
      const institute = String(item.faculty_title ?? '').trim();
      if (!Number.isFinite(Number(item.id)) || !title || !institute) continue;
      unique.set(Number(item.id), {
        id: Number(item.id), title, course: Number(item.kurs) || null, institute,
        students: Number(item.students) || null, studyForm: String(item.fo ?? '').trim(),
      });
    }
    return [...unique.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  #cleanTeachers(items) {
    const unique = new Map();
    for (const item of items) {
      const id = Number(item.id);
      const name = String(item.name ?? '').trim();
      const fullName = String(item.full_name ?? '').trim();
      if (!Number.isFinite(id) || (!name && !fullName)) continue;
      const candidate = { id, name, fullName: fullName || name, active: item.active !== false };
      const current = unique.get(id);
      if (!current || (!current.active && candidate.active)) unique.set(id, candidate);
    }
    return [...unique.values()].filter((item) => item.active)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  }

  #cleanAuditories(items) {
    return items.map((item) => ({
      id: Number(item.id), title: String(item.title ?? '').trim(),
      capacity: Number(item.maxstud) || null, multimedia: Boolean(item.is_mm),
      computerClass: Boolean(item.is_vt),
    })).filter((item) => item.id > 0 && item.title && item.title !== '-')
      .sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }));
  }
}
