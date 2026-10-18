import type { HomeworkAttachment } from '../components/HomeworkAttachments';
import { addDays, fromDateKey, toDateKey } from '../lib/date';
import { useCallback, useEffect, useState } from 'react';
import type { Lesson } from './schedule';
import { apiRequest } from '../lib/api';

export type Deadline = { kind: 'lesson' | 'next' | 'date'; local?: string; at?: string; timeZone?: string };
export type Submission = { kind: 'class' | 'moodle' | 'system' | 'email' | 'other'; label?: string; url?: string | null };
export type HomeworkSnapshot = { text: string; attachments?: HomeworkAttachment[]; deadline?: Deadline; submission?: Submission | null };
export type HomeworkEvent = { type: string; version?: number; at: string; by?: string | number; authorName?: string; before?: HomeworkSnapshot | null; after?: HomeworkSnapshot; restoredFrom?: number; added?: HomeworkAttachment[]; removed?: HomeworkAttachment[]; from?: { date: string; time?: string }; to?: { date: string; time?: string } | null };
export type HomeworkDetailsInput = { deadline?: Deadline; submission?: Submission | null; restoreVersion?: number };
export type HomeworkItem = {
  deadline?: Deadline;
  submission?: Submission | null;
  dueAt?: string | null;
  sharedDueAt?: string | null;
  personalDueAt?: string | null;
  sharedDeadline?: Deadline;
  personalDeadline?: Deadline;
  sharedSubmission?: Submission | null;
  personalSubmission?: Submission | null;
  sharedHistory?: HomeworkEvent[];
  personalHistory?: HomeworkEvent[];
  attachments?: HomeworkAttachment[];
  sharedAttachments?: HomeworkAttachment[];
  personalAttachments?: HomeworkAttachment[];
  status?: 'active' | 'orphaned';
  groupId: string | number;
  date: string;
  lessonNumber: number;
  subgroup: number | null;
  subject: string;
  lessonTime: string;
  sharedAuthorName?: string | null;
  sharedUpdatedAt?: string;
  sharedVersion?: number;
  sharedText: string | null;
  personalText: string | null;
  text: string;
  source: 'shared' | 'personal';
  updatedAt: string;
  authorName: string | null;
  version: number;
  remindAt: string | null;
  reminderMode?: 'fixed' | 'lesson' | 'due-day' | 'due-morning' | null;
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

export const loadHomework = (groupId: string | number, from: string, to: string) =>
  apiRequest<HomeworkData>(`/api/homework?groupId=${groupId}&from=${toDateKey(addDays(fromDateKey(from), -1))}&to=${toDateKey(addDays(fromDateKey(to), 1))}&includeOverdue=true`);

// remindAt: undefined — напоминание не трогаем, null — снять, ISO — поставить (напоминание личное).
export const saveHomework = (
  lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup' | 'groupId'>, text: string | null, scope: 'shared' | 'personal' | 'reminder', remindAt?: string | null, reminderMode?: 'fixed' | 'lesson' | 'due-day' | 'due-morning', minutesBefore?: number, attachments?: HomeworkAttachment[], details?: HomeworkDetailsInput,
) =>
  apiRequest<{ item?: HomeworkItem }>('/api/homework', {
    method: 'PUT',
    body: JSON.stringify({
      groupId: lesson.groupId,
      date: lesson.date,
      lessonNumber: lesson.lessonNumber,
      subgroup: lesson.subgroup,
      text,
      ...details,
      ...(attachments ? { attachmentIds: attachments.map((file) => file.id) } : {}),
      scope,
      reminderMode,
      minutesBefore,
      ...(remindAt !== undefined ? { remindAt } : {}),
    }),
  });

export const useRemoteHomework = (groupId: string | number, from: string, to: string, dependency?: unknown) => {
  const [state, setState] = useState<HomeworkState>({ status: 'loading' });
  const refresh = useCallback((silent = false) => {
    // Тихое обновление после сохранения не прячет уже показанное ДЗ за спиннером.
    if (!silent) setState({ status: 'loading' });
    return loadHomework(groupId, from, to)
      .then((data) => setState({ status: 'ready', data }) as void)
      .catch((error: Error) => setState({ status: 'error', message: error.message }));
  }, [groupId, from, to, dependency]);
  useEffect(() => {
    void refresh();
    const update = () => { if (!document.hidden) void refresh(true); };
    const timer = window.setInterval(update, 10_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh]);
  return [state, refresh] as const;
};
