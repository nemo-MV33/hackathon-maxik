import { ResourceCache } from '../lib/resource-cache.mjs';
import { currentUser } from '../bridge/max';
import type { HomeworkAttachment } from '../components/HomeworkAttachments';
import { addDays, fromDateKey, toDateKey } from '../lib/date';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lesson } from './schedule';
import { apiRequest } from '../lib/api';

export type Deadline = { kind: 'lesson' | 'next' | 'date'; local?: string; at?: string; timeZone?: string };
export type Submission = { kind: 'class' | 'moodle' | 'system' | 'email' | 'other'; label?: string; url?: string | null };
export type HomeworkSnapshot = { text: string; attachments?: HomeworkAttachment[]; deadline?: Deadline; submission?: Submission | null };
export type HomeworkEvent = { type: string; version?: number; at: string; by?: string | number; authorName?: string; before?: HomeworkSnapshot | null; after?: HomeworkSnapshot; restoredFrom?: number; added?: HomeworkAttachment[]; removed?: HomeworkAttachment[]; from?: { date: string; time?: string }; to?: { date: string; time?: string } | null };
export type HomeworkDetailsInput = { standalone?: boolean; subject?: string; deadline?: Deadline; submission?: Submission | null; restoreVersion?: number };
export type HomeworkItem = {
  standalone?: boolean;
  completed?: boolean;
  completionRevision?: string;
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

const requests = new ResourceCache(5000);
export const homeworkChanged = () => { requests.clear(); homeworkCache.clear(); window.dispatchEvent(new Event('homework-changed')); };

export const completeHomework = async (item: HomeworkItem, completed: boolean) => {
  await apiRequest('/api/homework', { method: 'PUT', body: JSON.stringify({ groupId: item.groupId, date: item.date, lessonNumber: item.lessonNumber, subgroup: item.subgroup, scope: 'completion', revision: item.completionRevision, completed }) });
  homeworkChanged();
};

export const loadHomework = (groupId: string | number, from: string, to: string) =>
  apiRequest<HomeworkData>(`/api/homework?groupId=${groupId}&from=${toDateKey(addDays(fromDateKey(from), -1))}&to=${toDateKey(addDays(fromDateKey(to), 1))}&includeOverdue=true`);

// remindAt: undefined — напоминание не трогаем, null — снять, ISO — поставить (напоминание личное).
export const saveHomework = (
  lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup' | 'groupId' | 'standalone'>, text: string | null, scope: 'shared' | 'personal' | 'reminder', remindAt?: string | null, reminderMode?: 'fixed' | 'lesson' | 'due-day' | 'due-morning', minutesBefore?: number, attachments?: HomeworkAttachment[], details?: HomeworkDetailsInput,
) =>
  apiRequest<{ item?: HomeworkItem }>('/api/homework', {
    method: 'PUT',
    body: JSON.stringify({
      groupId: lesson.groupId,
      ...(lesson.standalone ? { standalone: true } : {}),
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
  }).then((data) => { homeworkChanged(); return data; });

const homeworkCache = new Map<string, HomeworkData>();

export const useRemoteHomework = (groupId: string | number, from: string, to: string, dependency?: unknown) => {
  const actor = currentUser()?.id ?? new URLSearchParams(location.search).get('demoUser') ?? 'anonymous';
  const cacheKey = `${actor}:${groupId}:${from}:${to}`;
  const latest = useRef(cacheKey);
  const sequence = useRef(0);
  latest.current = cacheKey;
  const cachedState = (): HomeworkState => homeworkCache.has(cacheKey) ? { status: 'ready', data: homeworkCache.get(cacheKey)! } : { status: 'loading' };
  const [result, setResult] = useState<{ key: string; state: HomeworkState }>(() => ({ key: cacheKey, state: cachedState() }));
  const refresh = useCallback((silent = false) => {
    const request = ++sequence.current;
    if (!silent) setResult({ key: cacheKey, state: { status: 'loading' } });
    return requests.get(cacheKey, () => loadHomework(groupId, from, to)).then((data) => {
      if (latest.current !== cacheKey || request !== sequence.current) return;
      if (homeworkCache.size >= 100) homeworkCache.delete(homeworkCache.keys().next().value!);
      homeworkCache.set(cacheKey, data);
      setResult({ key: cacheKey, state: { status: 'ready', data } });
    }).catch((error: Error) => {
      if (latest.current === cacheKey && request === sequence.current) setResult({ key: cacheKey, state: { status: 'error', message: error.message } });
    });
  }, [cacheKey, groupId, from, to, dependency]);
  useEffect(() => {
    void refresh(homeworkCache.has(cacheKey));
    const update = () => { if (!document.hidden) { requests.clear(); void refresh(true); } };
    const timer = window.setInterval(update, 10_000);
    window.addEventListener('focus', update);
    window.addEventListener('homework-changed', update);
    return () => {
      sequence.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('homework-changed', update);
    };
  }, [refresh]);
  return [result.key === cacheKey ? result.state : cachedState(), refresh] as const;
};
