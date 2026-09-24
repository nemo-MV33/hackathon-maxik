export type MaxUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type WebApp = {
  initData: string;
  initDataUnsafe: { user?: MaxUser; start_param?: string };
  platform?: string;
  ready?: () => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
  shareMaxContent?: (params: { text?: string; link?: string }) => void;
};

declare global {
  interface Window {
    WebApp?: WebApp;
  }
}

export const BOT_NAME = import.meta.env.VITE_BOT_NAME ?? 't692_hakaton_max_bot';

export const webApp = (): WebApp | undefined => window.WebApp;
export const currentUser = (): MaxUser | undefined => window.WebApp?.initDataUnsafe?.user;

export const startParam = (): string | undefined => {
  const fromMax = window.WebApp?.initDataUnsafe?.start_param;
  if (fromMax) return fromMax;
  return new URLSearchParams(window.location.search).get('startapp') ?? undefined;
};

export const miniAppLink = (payload: string) => `https://max.ru/${BOT_NAME}?startapp=${payload}`;

export const haptic = {
  success: () => window.WebApp?.HapticFeedback?.notificationOccurred('success'),
  tap: () => window.WebApp?.HapticFeedback?.impactOccurred('light'),
};

export type ShareResult = 'max' | 'native' | 'clipboard' | 'failed';

export const shareText = async (text: string, link: string): Promise<ShareResult> => {
  const app = window.WebApp;
  if (app?.shareMaxContent && app.platform && app.platform !== 'web') {
    try {
      app.shareMaxContent({ text, link });
      return 'max';
    } catch {}
  }
  if (navigator.share) {
    try {
      await navigator.share({ text: `${text}\n${link}` });
      return 'native';
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'failed';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${link}`);
    return 'clipboard';
  } catch {
    return 'failed';
  }
};
