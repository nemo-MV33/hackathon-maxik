import { addDays, startOfWeek, toDateKey } from '../lib/date.js';
import { lessonMoments, zonedDateKey } from '../lib/timezone.js';
import { universities, university } from './config.js';
import { groupKey, splitGroupKey } from './identity.js';

// Контракт провайдера: groups, institutes, searchGroups, teachers, auditories,
// searchTeachers, searchAuditories, groupSchedule, teacherSchedule, auditorySchedule.
// Неподдерживаемые справочники возвращают []; возможности объявлены в конфиге.
export class UniversityService {
  constructor(providers) { this.providers = providers; }
  universities() { return universities.filter((item) => this.providers[item.id]); }
  provider(id = 'irnitu') { university(id); if (!this.providers[id]) throw new Error('provider_unavailable'); return this.providers[id]; }
  async groups(universityId = 'irnitu') {
    return (await this.provider(universityId).groups()).map((group) => ({ ...group, id: groupKey(group.id, universityId), universityId }));
  }
  institutes(universityId) { return this.provider(universityId).institutes(); }
  async searchGroups(query, { universityId = 'irnitu', ...options } = {}) {
    return (await this.provider(universityId).searchGroups(query, options)).map((group) => ({ ...group, id: groupKey(group.id, universityId), universityId }));
  }
  async teachers(universityId = 'irnitu') { return (await this.provider(universityId).teachers()).map((item) => ({ ...item, id: groupKey(item.id, universityId), universityId })); }
  async auditories(universityId = 'irnitu') { return (await this.provider(universityId).auditories()).map((item) => ({ ...item, id: groupKey(item.id, universityId), universityId })); }
  async searchTeachers(query, { universityId = 'irnitu', ...options } = {}) { return (await this.provider(universityId).searchTeachers(query, options)).map((item) => ({ ...item, id: groupKey(item.id, universityId), universityId })); }
  async searchAuditories(query, { universityId = 'irnitu', ...options } = {}) { return (await this.provider(universityId).searchAuditories(query, options)).map((item) => ({ ...item, id: groupKey(item.id, universityId), universityId })); }
  async groupSchedule(value, options = {}) {
    const id = groupKey(value);
    const { universityId, sourceId } = splitGroupKey(id);
    const config = university(universityId);
    const week = options.week ?? new Date(`${zonedDateKey(new Date(), config.timeZone)}T00:00:00Z`);
    const result = await this.provider(universityId).groupSchedule(sourceId, { ...options, week, raw: true, subgroup: undefined });
    let lessons = result.lessons.map((lesson) => ({ ...lesson, groupIds: (lesson.groupIds ?? [sourceId]).map((groupId) => groupKey(groupId, universityId)) }));
    const from = toDateKey(startOfWeek(week));
    const to = toDateKey(addDays(startOfWeek(week), 6));
    if (!options.raw && this.lessonChanges) lessons = await this.lessonChanges.overlay(id, lessons, from, to);
    return { ...result, entityId: id, universityId, timeZone: config.timeZone,
      lessons: lessons.filter((lesson) => !options.subgroup || !lesson.subgroup || lesson.subgroup === options.subgroup)
        .map((lesson) => ({ ...lessonMoments(lesson, config.timeZone), groupId: id })) };
  }
  async teacherSchedule(id, options = {}) { return this.#entity('teacher', id, options); }
  async auditorySchedule(id, options = {}) { return this.#entity('auditory', id, options); }
  async #entity(kind, id, { universityId = 'irnitu', ...options }) {
    if (String(id).includes('~')) { const ref = splitGroupKey(id); universityId = ref.universityId; id = ref.sourceId; }
    const config = university(universityId);
    const week = options.week ?? new Date(`${zonedDateKey(new Date(), config.timeZone)}T00:00:00Z`);
    const result = await this.provider(universityId)[`${kind}Schedule`](id, { ...options, week });
    return { ...result, entityId: groupKey(id, universityId), universityId, timeZone: university(universityId).timeZone,
      lessons: result.lessons.map((lesson) => ({ ...lessonMoments(lesson, university(universityId).timeZone), groupIds: (lesson.groupIds ?? []).map((id) => groupKey(id, universityId)) })) };
  }
}
