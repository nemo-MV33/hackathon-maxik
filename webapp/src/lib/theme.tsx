import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'norfly.theme';

const readChoice = (): ThemeChoice => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
  } catch {}
  return 'auto';
};

// «Авто» берёт тему устройства: MAX выставляет её и для мини-приложения.
const systemTheme = (): ResolvedTheme =>
  (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

type Theme = { choice: ThemeChoice; resolved: ResolvedTheme; setChoice: (value: ThemeChoice) => void };
const ThemeContext = createContext<Theme>({ choice: 'auto', resolved: 'light', setChoice: () => {} });

export const ThemeProvider = ({ children }: { children: (resolved: ResolvedTheme) => ReactNode }) => {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = choice === 'auto' ? system : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#161412' : '#f1ebdf');
  }, [resolved]);

  const setChoice = useCallback((value: ThemeChoice) => {
    try { localStorage.setItem(KEY, value); } catch {}
    setChoiceState(value);
  }, []);
  const value = useMemo(() => ({ choice, resolved, setChoice }), [choice, resolved, setChoice]);
  return <ThemeContext.Provider value={value}>{children(resolved)}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
