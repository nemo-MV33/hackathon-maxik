import { ResourceCache } from '../lib/resource-cache.mjs';
import { addDays, fromDateKey, toDateKey } from '../lib/date';
import { lessonDate, userTimeZone } from '../lib/timezone';
import { apiRequest } from '../lib/api';
import { t } from '../lib/i18n';
import { groupTimeZone, scopedGroupId, universityOf } from '../lib/universities';

const DATA_URL = `${import.meta.env.BASE_URL}data/`;

export type Group = { id: string | number; universityId?: string; title: string; institute: string; course: number | null };

export type Lesson = {
  standalone?: boolean;
  stale?: boolean;
  groupId?: string | number;
  startsAt?: string; endsAt?: string; timeZone?: string;
  updatedAt?: string | null;
  markedBy?: string;
  markedAt?: string;
  moveId?: string;
  date: string;
  lessonNumber: number;
  time: string;
  subject: string;
  lessonType: string;
  subgroup: number | null;
  teachers: string[];
  auditories: string[];
  // Корпус или адрес, если источник отдаёт его отдельно от аудитории.
  building?: string;
  comment?: string;
  link?: string;
  transferred?: boolean;
  groups?: string[];
};

export type WeekSchedule = { stale?: boolean; updatedAt?: string | null; weekStart: string; weekEven: boolean | null; lessons: Lesson[] };

export type Meta = { updatedAt: string; weeks: string[]; groups: number; failed: number };

export class DataError extends Error {
  constructor(readonly kind: 'missing' | 'network') {
    super(kind === 'missing' ? t().scheduleMissing : t().network);
  }
}

const cache = new Map<string, Promise<unknown>>();

const load = <T>(path: string): Promise<T> => {
  const cached = cache.get(path);
  if (cached) return cached as Promise<T>;
  const promise = fetch(`${DATA_URL}${path}`)
    .catch(() => { throw new DataError('network'); })
    .then((response) => {
      if (!response.ok) throw new DataError('missing');
      return response.json() as Promise<T>;
    });
  promise.catch(() => cache.delete(path));
  cache.set(path, promise);
  return promise;
};

export const loadMeta = () => load<Meta>('meta.json');
// Статическая выгрузка — запасной путь, если API недоступен.
const staticGroups = async (universityId: string) => (await load<Group[]>('groups.json'))
  .map((group) => ({ ...group, id: scopedGroupId(group.id) }))
  .filter((group) => (group.universityId ?? 'irnitu') === universityId);

const compact = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-–—/_]+/g, '');

// У крупных вузов тысячи групп, поэтому поиск идёт на сервере, а в телефон приходят 30 совпадений.
export const searchGroups = async (universityId: string, query: string): Promise<Group[]> => {
  try {
    const params = new URLSearchParams({ universityId, q: query, limit: '30' });
    return (await apiRequest<{ items: Group[] }>(`/api/groups?${params}`)).items;
  } catch {
    const needle = compact(query);
    return (await staticGroups(universityId)).filter((group) => compact(group.title).includes(needle)).slice(0, 30);
  }
};

export type CatalogItem = { id: string; title: string; hint?: string; course?: number | null; kind: 'node' | 'group'; institute?: string; universityId?: string };
// Каталог вуза: '' — направления, дальше путь через «/». Ответы кэшируются на сервере на неделю.
export const loadCatalog = (universityId: string, path: string) =>
  apiRequest<{ items: CatalogItem[] }>(`/api/catalog?${new URLSearchParams({ universityId, path })}`).then((data) => data.items);

export const findGroup = async (groupId: string | number): Promise<Group | undefined> => {
  const id = scopedGroupId(groupId);
  try { return (await apiRequest<{ items: Group[] }>(`/api/groups?id=${encodeURIComponent(id)}`)).items[0]; }
  catch { return (await staticGroups(universityOf(id).id)).find((group) => group.id === id); }
};
const sourceCache = new ResourceCache();
window.addEventListener('focus', () => sourceCache.clear());
export const invalidateSchedule = () => { cache.clear(); sourceCache.clear(); };

// Динамический API применяет отметки старосты и запускает обновление устаревшей недели.
// Статическая выгрузка остаётся доступной при недоступности сервера.
const fetchSourceWeek = async (groupId: string | number, weekStart: string, kind: 'group' | 'teacher' | 'auditory' = 'group'): Promise<WeekSchedule> => {
  try {
    const result = await apiRequest<WeekSchedule>(`/api/schedule/${kind}/${groupId}?week=${weekStart}`);
    return { ...result, weekStart, lessons: result.lessons.map((lesson) => ({ ...lesson, stale: result.stale, updatedAt: lesson.updatedAt ?? result.updatedAt })) };
  } catch (error) {
    if (kind !== 'group') throw error;
    try { return await load<WeekSchedule>(`schedule/${groupId}/${weekStart}.json`); }
    catch (error) {
      if (String(groupId).startsWith('irnitu~')) return load<WeekSchedule>(`schedule/${String(groupId).split('~')[1]}/${weekStart}.json`);
      throw error;
    }
  }
};

const loadSourceWeek = (groupId: string | number, weekStart: string, kind: 'group' | 'teacher' | 'auditory' = 'group') => {
  return sourceCache.get(`${kind}:${groupId}:${weekStart}`, () => fetchSourceWeek(groupId, weekStart, kind));
};

// Границы пользовательской недели могут пересекать соседнюю неделю вуза.
export const loadWeek = async (groupId: string | number, weekStart: string, kind: 'group' | 'teacher' | 'auditory' = 'group'): Promise<WeekSchedule> => {
  const primary = await loadSourceWeek(groupId, weekStart, kind);
  if (userTimeZone() === groupTimeZone(groupId)) return primary;
  const adjacent = await Promise.all([-7, 7].map((offset) => loadSourceWeek(groupId, toDateKey(addDays(fromDateKey(weekStart), offset)), kind).catch(() => null)));
  const unique = new Map([primary, ...adjacent].flatMap((week) => week?.lessons ?? []).map((lesson) => [
    JSON.stringify([lesson.date, lesson.lessonNumber, lesson.subgroup, lesson.subject, lesson.lessonType, lesson.teachers, lesson.auditories]), lesson,
  ]));
  return { ...primary, lessons: [...unique.values()].sort((a, b) => `${lessonDate(a)} ${a.startsAt ?? a.time}`.localeCompare(`${lessonDate(b)} ${b.startsAt ?? b.time}`)) };
};
