import { useCallback, useState } from 'react';
import type { Group } from '../data/schedule';

export type LocalProfile = { group: Group; subgroup: 1 | 2 | null };

const KEY = 'norfly.profile';

const read = (): LocalProfile | null => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return value?.group?.id ? value : null;
  } catch {
    return null;
  }
};

export const useProfile = () => {
  const [profile, setProfile] = useState<LocalProfile | null>(read);
  const save = useCallback((value: LocalProfile | null) => {
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value));
      else localStorage.removeItem(KEY);
    } catch {}
    setProfile(value);
  }, []);
  return [profile, save] as const;
};
