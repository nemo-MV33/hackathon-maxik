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

export type ControlForm = 'exam' | 'credit' | 'graded_credit' | 'coursework' | 'none';

export type RemoteProfile = {
  group: { id: number; title: string } | null;
  institute: string | null;
  course: number | null;
  subgroup: 1 | 2 | null;
  lang: 'ru' | 'en' | null;
  remindersEnabled: boolean;
  muted: boolean;
  reminderMinutes: number;
  endMinutes: number;
  summaryTime: string;
  onboarded: boolean;
  notifications: Notifications;
  controls: Record<string, ControlForm>;
};

export type Notifications = {
  summary: boolean; homework: boolean; changes: boolean; exams: boolean; announcements: boolean; lessonEnd: boolean;
};
export type SettingsPatch = {
  remindersEnabled?: boolean; muted?: boolean; onboarded?: boolean; reminderMinutes?: number; endMinutes?: number;
  summaryTime?: string; notifications?: Partial<Notifications>; controls?: Record<string, ControlForm | null>;
};

export type RemoteUser = { id: number; firstName: string | null; lastName: string | null; username: string | null };
export type Role = 'headman' | 'editor' | 'student';
export type MeResponse = {
  user: RemoteUser;
  profile: RemoteProfile;
  role: Role;
  headman: { name: string } | null;
  deputy: { userId: number; name: string } | null;
  chatLinked: boolean;
};

export const loadMe = () => apiRequest<MeResponse>('/api/me');
export const deleteAccount = () => apiRequest<{ deleted: true }>('/api/me', { method: 'DELETE' });

export const updateSettings = (patch: SettingsPatch) =>
  apiRequest<{ profile: RemoteProfile }>('/api/me', { method: 'PUT', body: JSON.stringify(patch) });

export type AbsenceKind = 'late' | 'absent';
export type AbsenceInput = {
  kind: AbsenceKind;
  reason?: string;
  text?: string;
  minutes?: number;
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
  minutes?: number;
  date?: string;
  createdAt: string;
  acceptedAt: string | null;
};

export const loadAbsences = (date?: string) =>
  apiRequest<{ role: 'headman' | 'student'; date: string; items: AbsenceNote[] }>(`/api/absence${date ? `?date=${date}` : ''}`);

export type StudentSummary = { id: number; name: string; totalMinutes: number; late: number; absent: number; last: string };
export type AbsenceHistory = { role: 'headman' | 'student'; mine: AbsenceNote[]; students: StudentSummary[] };
export type StudentDossier = { role: 'headman'; student: StudentSummary & { items: AbsenceNote[] } };

export const loadAbsenceHistory = () => apiRequest<AbsenceHistory>('/api/absence/history');
export const loadStudentDossier = (id: number) => apiRequest<StudentDossier>(`/api/absence/history?student=${id}`);

export type Member = { userId: number; name: string };
export const loadGroupMembers = () => apiRequest<{ deputy: Member | null; members: Member[] }>('/api/group/members');
export const saveDeputy = (userId: number | null) =>
  apiRequest<{ deputy: Member | null }>('/api/deputy', { method: 'PUT', body: JSON.stringify({ userId }) });

export type Announcement = {
  id: string;
  title: string | null;
  text: string;
  eventAt: string | null;
  remindAt: string | null;
  myRemindAt: string | null;
  customized: boolean;
  authorName: string | null;
  createdAt: string;
  mine: boolean;
};
export const loadAnnouncements = () => apiRequest<{ canPublish: boolean; items: Announcement[] }>('/api/announcements');
export const publishAnnouncement = (input: { text: string; remindAt: string | null }) =>
  apiRequest<{ item: Announcement; postedToChat: boolean }>('/api/announcements', { method: 'POST', body: JSON.stringify(input) });
export const removeAnnouncement = (id: string) => apiRequest(`/api/announcements/${id}`, { method: 'DELETE' });
export const saveAnnouncementReminder = (id: string, body: { remindAt: string | null } | { reset: true }) =>
  apiRequest<{ item: Announcement }>(`/api/announcements/${id}/reminder`, { method: 'PUT', body: JSON.stringify(body) });
