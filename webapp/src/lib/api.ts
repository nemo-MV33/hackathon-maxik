import { webApp } from '../bridge/max';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message || 'Не удалось выполнить действие');
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
    throw new ApiError(0, 'network', 'Нет связи с сервисом. Проверь интернет');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.error, body.message);
  return body as T;
};

export const syncProfile = (groupId: number, subgroup: 1 | 2 | null) => apiRequest('/api/me', {
  method: 'PUT', body: JSON.stringify({ groupId, subgroup }),
});
