import { addDays, fromDateKey, toDateKey } from '../lib/date';
import { lessonDate, userTimeZone } from '../lib/timezone';
import { apiRequest } from '../lib/api';
import { t } from '../lib/i18n';

const DATA_URL = `${import.meta.env.BASE_URL}data/`;

export type Group = { id: string | number; universityId?: string; title: string; institute: string; course: number | null };

export type Lesson = {
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
  comment?: string;
  link?: string;
  transferred?: boolean;
  groups?: string[];
};

export type WeekSchedule = { stale?: boolean; updatedAt?: string | null; weekStart: string; weekEven: boolean; lessons: Lesson[] };

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
export const loadGroups = async (universityId = 'irnitu'): Promise<Group[]> => {
  try { return (await apiRequest<{ items: Group[] }>(`/api/groups?universityId=${universityId}&limit=5000`)).items; }
  catch { return (await load<Group[]>('groups.json')).map((group) => ({ ...group, id: /^\d+$/.test(String(group.id)) ? `irnitu~${group.id}` : group.id })).filter((group) => (group.universityId ?? 'irnitu') === universityId); }
};
export const invalidateSchedule = () => cache.clear();

// Динамический API применяет отметки старосты и запускает обновление устаревшей недели.
// Статическая выгрузка остаётся доступной при недоступности сервера.
const loadSourceWeek = async (groupId: string | number, weekStart: string, kind: 'group' | 'teacher' | 'auditory' = 'group'): Promise<WeekSchedule> => {
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

// Границы пользовательской недели могут пересекать соседнюю неделю вуза.
export const loadWeek = async (groupId: string | number, weekStart: string, kind: 'group' | 'teacher' | 'auditory' = 'group'): Promise<WeekSchedule> => {
  const primary = await loadSourceWeek(groupId, weekStart, kind);
  if (userTimeZone() === 'Asia/Irkutsk') return primary;
  const adjacent = await Promise.all([-7, 7].map((offset) => loadSourceWeek(groupId, toDateKey(addDays(fromDateKey(weekStart), offset)), kind).catch(() => null)));
  const unique = new Map([primary, ...adjacent].flatMap((week) => week?.lessons ?? []).map((lesson) => [
    JSON.stringify([lesson.date, lesson.lessonNumber, lesson.subgroup, lesson.subject, lesson.lessonType, lesson.teachers, lesson.auditories]), lesson,
  ]));
  return { ...primary, lessons: [...unique.values()].sort((a, b) => `${lessonDate(a)} ${a.startsAt ?? a.time}`.localeCompare(`${lessonDate(b)} ${b.startsAt ?? b.time}`)) };
};
