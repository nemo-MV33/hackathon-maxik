import { useCallback, useEffect, useState } from 'react';
import type { Lesson } from './schedule';
import { apiRequest } from '../lib/api';

export type HomeworkItem = {
  groupId: number;
  date: string;
  lessonNumber: number;
  subgroup: number | null;
  subject: string;
  lessonTime: string;
  sharedText: string | null;
  personalText: string | null;
  text: string;
  source: 'shared' | 'personal';
  updatedAt: string;
  authorName: string | null;
  version: number;
};

export type HomeworkData = {
  group: { id: number; title: string };
  role: 'headman' | 'editor' | 'member' | 'student';
  canEditShared: boolean;
  period: { from: string; to: string };
  items: HomeworkItem[];
};

export type HomeworkState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: HomeworkData };

export const homeworkKey = (lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup'>) =>
  `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;

export const loadHomework = (groupId: number, from: string, to: string) =>
  apiRequest<HomeworkData>(`/api/homework?groupId=${groupId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

export const saveHomework = (lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup'>, text: string | null, scope: 'shared' | 'personal') =>
  apiRequest('/api/homework', {
    method: 'PUT',
    body: JSON.stringify({
      date: lesson.date,
      lessonNumber: lesson.lessonNumber,
      subgroup: lesson.subgroup,
      text,
      scope,
    }),
  });

export const useRemoteHomework = (groupId: number, from: string, to: string, dependency?: unknown) => {
  const [state, setState] = useState<HomeworkState>({ status: 'loading' });
  const refresh = useCallback((silent = false) => {
    // Тихое обновление после сохранения не прячет уже показанное ДЗ за спиннером.
    if (!silent) setState({ status: 'loading' });
    return loadHomework(groupId, from, to)
      .then((data) => setState({ status: 'ready', data }) as void)
      .catch((error: Error) => setState({ status: 'error', message: error.message }));
  }, [groupId, from, to, dependency]);
  useEffect(() => { void refresh(); }, [refresh]);
  return [state, refresh] as const;
};
