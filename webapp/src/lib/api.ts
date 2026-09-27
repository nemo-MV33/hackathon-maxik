import { webApp } from '../bridge/max';
import { t } from './i18n';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message || t().failed);
  }
}

export const apiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const initData = webApp()?.initData;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(initData ? { Authorization: `tma ${initData}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network', t().network);
  }
  const body = await response.json().catch(() => ({}));
  // Без initData MAX сервер не знает пользователя: так бывает, если открыть приложение ссылкой в браузере.
  if (response.status === 401) throw new ApiError(401, 'unauthorized', t().outsideMax);
  if (!response.ok) throw new ApiError(response.status, body.error, body.message);
  return body as T;
};

export type RemoteProfile = {
  group: { id: number; title: string } | null;
  institute: string | null;
  course: number | null;
  subgroup: 1 | 2 | null;
  lang: 'ru' | 'en' | null;
  remindersEnabled: boolean;
  onboarded: boolean;
  notifications: Notifications;
};

export type Notifications = { summary: boolean; homework: boolean; changes: boolean; exams: boolean };
export type SettingsPatch = { remindersEnabled?: boolean; onboarded?: boolean; notifications?: Partial<Notifications> };

export type RemoteUser = { id: number; firstName: string | null; lastName: string | null; username: string | null };

export const loadMe = () => apiRequest<{ user: RemoteUser; profile: RemoteProfile }>('/api/me');

export const updateSettings = (patch: SettingsPatch) =>
  apiRequest<{ profile: RemoteProfile }>('/api/me', { method: 'PUT', body: JSON.stringify(patch) });

export type AbsenceKind = 'late' | 'absent';
export type AbsenceInput = {
  kind: AbsenceKind;
  reason?: string;
  text?: string;
  lessonDate?: string;
  lessonNumber?: number;
};

export const sendAbsence = (input: AbsenceInput) =>
  apiRequest<{ status: 'sent' | 'pending' }>('/api/absence', { method: 'POST', body: JSON.stringify(input) });

export const syncProfile = (groupId: number, subgroup: 1 | 2 | null) => apiRequest('/api/me', {
  method: 'PUT', body: JSON.stringify({ groupId, subgroup }),
});

export type AbsenceNote = {
  id: string;
  kind: AbsenceKind;
  senderName: string | null;
  reason: string | null;
  text: string | null;
  lesson: { date: string; lessonNumber: number; subject: string; time: string } | null;
  createdAt: string;
  acceptedAt: string | null;
};

export const loadAbsences = (date?: string) =>
  apiRequest<{ role: 'headman' | 'student'; date: string; items: AbsenceNote[] }>(`/api/absence${date ? `?date=${date}` : ''}`);
