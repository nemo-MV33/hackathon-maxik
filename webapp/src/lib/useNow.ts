import { useEffect, useState } from 'react';
import { irkutskNow } from './date';

const TICK_MS = 30_000;

// Время по Иркутску, которое обновляется, пока приложение открыто.
export const useNow = () => {
  const [now, setNow] = useState(irkutskNow);
  useEffect(() => {
    const tick = () => setNow(irkutskNow());
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
};
