import { useEffect, useState } from 'react';
import { userNow } from './date';

const TICK_MS = 30_000;

// Время пользователя, которое обновляется, пока приложение открыто.
export const useNow = () => {
  const [now, setNow] = useState(userNow);
  useEffect(() => {
    const tick = () => setNow(userNow());
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('norfly:timezone', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('norfly:timezone', tick);
    };
  }, []);
  return now;
};
