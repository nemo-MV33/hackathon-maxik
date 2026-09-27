import { useCallback, useEffect, useState } from 'react';
import type { Group } from '../data/schedule';

export type LocalProfile = { group: Group; subgroup: 1 | 2 | null };

const KEY = 'norfly.profile';
const EVENT = 'norfly:profile';

const read = (): LocalProfile | null => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return value?.group?.id ? value : null;
  } catch {
    return null;
  }
};

// Выбор группы нужен многим экранам сразу: сохранение в одном месте сразу видно во всех.
let memory: LocalProfile | null = read();

export const useProfile = () => {
  const [profile, setProfile] = useState<LocalProfile | null>(memory);
  useEffect(() => {
    const sync = () => setProfile(memory);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const save = useCallback((value: LocalProfile | null) => {
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value));
      else localStorage.removeItem(KEY);
    } catch {}
    memory = value;
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [profile, save] as const;
};
