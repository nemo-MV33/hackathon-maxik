import { initData } from '../bridge/max';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code);
  }
}

export const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  const data = initData();
  if (data) headers.set('Authorization', `tma ${data}`);
  if (init.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'unknown', body?.message);
  }
  return body as T;
};

export type Profile = {
  group: { id: number; title: string } | null;
  institute: string | null;
  course: number | null;
  subgroup: 1 | 2 | null;
  remindersEnabled: boolean;
};

export type Me = {
  user: { id: number; firstName: string | null; lastName: string | null; username: string | null };
  profile: Profile;
};

export const getMe = () => request<Me>('/api/me');

export const updateMe = (patch: Partial<{ groupId: number; subgroup: 1 | 2 | null; remindersEnabled: boolean }>) =>
  request<{ profile: Profile }>('/api/me', { method: 'PUT', body: JSON.stringify(patch) });
