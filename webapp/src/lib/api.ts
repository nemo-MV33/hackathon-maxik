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
};

export const loadMe = () => apiRequest<{ profile: RemoteProfile }>('/api/me');

export const syncProfile = (groupId: number, subgroup: 1 | 2 | null) => apiRequest('/api/me', {
  method: 'PUT', body: JSON.stringify({ groupId, subgroup }),
});
