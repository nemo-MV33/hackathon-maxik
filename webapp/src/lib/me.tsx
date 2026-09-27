import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadMe, updateSettings, type MeResponse, type SettingsPatch } from './api';

type MeState = {
  me: MeResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: SettingsPatch) => Promise<void>;
};

const MeContext = createContext<MeState>({ me: null, error: null, refresh: async () => {}, update: async () => {} });

// Профиль с сервера общий для всех экранов: роль (староста или нет), настройки уведомлений, дисциплины.
export const MeProvider = ({ children, revision }: { children: ReactNode; revision: number }) => {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await loadMe());
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, revision]);

  const update = useCallback(async (patch: SettingsPatch) => {
    const { profile } = await updateSettings(patch);
    setMe((current) => (current ? { ...current, profile } : current));
  }, []);

  const value = useMemo(() => ({ me, error, refresh, update }), [me, error, refresh, update]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
};

export const useMe = () => useContext(MeContext);
