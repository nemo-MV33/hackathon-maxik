import { apiRequest } from '../lib/api';
import { t } from '../lib/i18n';

const DATA_URL = `${import.meta.env.BASE_URL}data/`;

export type Group = { id: number; title: string; institute: string; course: number | null };

export type Lesson = {
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

export type WeekSchedule = { updatedAt?: string | null; weekStart: string; weekEven: boolean; lessons: Lesson[] };

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
export const loadGroups = () => load<Group[]>('groups.json');
export const invalidateSchedule = () => cache.clear();

// Динамический API применяет отметки старосты и запускает обновление устаревшей недели.
// Статическая выгрузка остаётся доступной при недоступности сервера.
export const loadWeek = async (groupId: number, weekStart: string): Promise<WeekSchedule> => {
  try {
    const result = await apiRequest<WeekSchedule>(`/api/schedule/group/${groupId}?week=${weekStart}`);
    return { ...result, weekStart, lessons: result.lessons.map((lesson) => ({ ...lesson, updatedAt: lesson.updatedAt ?? result.updatedAt })) };
  } catch {
    return load<WeekSchedule>(`schedule/${groupId}/${weekStart}.json`);
  }
};
