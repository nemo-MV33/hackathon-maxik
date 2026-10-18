import { AsyncLocalStorage } from 'node:async_hooks';
import { groupKey, sameGroup } from '../universities/identity.js';
import { lessonMoments } from '../lib/timezone.js';
import { addDays, startOfWeek, toDateKey } from '../lib/date.js';
import { HttpError } from '../http/routes/me.js';

// Reserved source id; never exported into the public static schedule directory.
export const DEMO_GROUP = { id: 'irnitu~999999991', title: 'ДЕМО-25-1', universityId: 'irnitu', institute: 'Демонстрация', course: 1 };
export const demoContext = new AsyncLocalStorage();
export const demoAllowed = (userId = demoContext.getStore()?.userId) => userId === 'internal' || (process.env.DEMO_MAX_IDS || '').split(',').map((id) => id.trim()).filter(Boolean).includes(String(userId));
export const isDemo = (id) => { try { return id != null && sameGroup(id, DEMO_GROUP.id); } catch { return false; } };
export const assertDemoAccess = (id, userId) => { if (isDemo(id) && !demoAllowed(userId)) throw new HttpError(404, 'not_found'); };

export const demoLessons = (week) => {
  const monday = startOfWeek(week);
  return [0, 1, 3].map((day, index) => lessonMoments({ date: toDateKey(addDays(monday, day)), lessonNumber: index === 1 ? 4 : 1,
    time: index === 1 ? '13:45–15:15' : '08:15–09:45', subject: 'Математический анализ', lessonType: 'Практика', subgroup: null,
    teachers: ['Преподаватель демо'], auditories: ['А-101'], groupId: DEMO_GROUP.id, groupIds: [DEMO_GROUP.id] }, 'Asia/Irkutsk'));
};

export const installDemo = (service) => {
  const groups = service.groups.bind(service); const search = service.searchGroups.bind(service); const schedule = service.groupSchedule.bind(service);
  service.groups = async (universityId = 'irnitu') => [...await groups(universityId).catch((error) => { if (demoAllowed()) return []; throw error; }), ...(universityId === 'irnitu' && demoAllowed() ? [DEMO_GROUP] : [])];
  service.searchGroups = async (query, options = {}) => {
    const items = await search(query, options).catch((error) => { if (demoAllowed()) return []; throw error; });
    if ((options.universityId ?? 'irnitu') === 'irnitu' && demoAllowed() && (!query || DEMO_GROUP.title.toLowerCase().includes(query.toLowerCase()))
      && (!options.institute || options.institute === DEMO_GROUP.institute) && (!options.course || Number(options.course) === 1)) return [DEMO_GROUP, ...items].slice(0, options.limit ?? 50);
    return items;
  };
  service.groupSchedule = async (id, options = {}) => {
    if (!isDemo(id)) return schedule(id, options);
    assertDemoAccess(id);
    const week = startOfWeek(options.week ?? new Date());
    let lessons = demoLessons(week);
    if (!options.raw && service.lessonChanges) lessons = await service.lessonChanges.overlay(DEMO_GROUP.id, lessons, toDateKey(week), toDateKey(addDays(week, 6)));
    return { entityId: DEMO_GROUP.id, universityId: 'irnitu', timeZone: 'Asia/Irkutsk', period: { from: week, to: addDays(week, 6) },
      updatedAt: new Date().toISOString(), stale: false, lessons: lessons.map((lesson) => lessonMoments(lesson, 'Asia/Irkutsk')) };
  };
  return service;
};
