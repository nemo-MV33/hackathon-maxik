import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

const ready = new Map<string, unknown>();
window.addEventListener('schedule-changed', () => ready.clear());

// Возврат на экран показывает последние данные сразу; обновление идёт в фоне.
export const useAsync = <T>(load: () => Promise<T>, deps: unknown[], namespace?: string, revision?: unknown) => {
  const key = namespace ? `${namespace}:${JSON.stringify(deps)}` : null;
  const [state, setState] = useState<AsyncState<T>>(() => key && ready.has(key) ? { status: 'ready', data: ready.get(key) as T } : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (key && ready.has(key)) setState({ status: 'ready', data: ready.get(key) as T });
    else setState({ status: 'loading' });
    load().then((data) => {
      if (!active) return;
      if (key) { if (ready.size > 100) ready.clear(); ready.set(key, data); }
      setState({ status: 'ready', data });
    }).catch((error: Error) => active && setState({ status: 'error', message: error.message }));
    return () => { active = false; };
  }, [...deps, attempt, revision]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [state, retry] as const;
};
