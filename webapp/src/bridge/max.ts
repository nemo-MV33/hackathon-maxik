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
  shareMaxContent?: (params: { text?: string; link?: string }) => Promise<unknown> | void;
  shareContent?: (params: { text?: string; link?: string }) => Promise<unknown>;
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

export type ShareResult =
  | { status: 'shared'; via: 'max' | 'native' }
  | { status: 'copied' }
  | { status: 'cancelled' }
  | { status: 'manual'; reason: string };

const errorCode = (error: unknown) => {
  const code = (error as { error?: { code?: string } })?.error?.code;
  return code ?? (error as Error)?.name ?? 'unknown';
};

export const shareText = (text: string, link: string): Promise<ShareResult> => {
  const app = window.WebApp;
  const full = `${text}\n${link}`;
  const reasons: string[] = [];

  const fallback = async (): Promise<ShareResult> => {
    if (app?.shareContent) {
      try {
        await app.shareContent({ text, link });
        return { status: 'shared', via: 'native' };
      } catch (error) {
        reasons.push(`share:${errorCode(error)}`);
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ text: full });
        return { status: 'shared', via: 'native' };
      } catch (error) {
        if ((error as Error).name === 'AbortError') return { status: 'cancelled' };
        reasons.push(`navigator:${errorCode(error)}`);
      }
    }
    try {
      await navigator.clipboard.writeText(full);
      return { status: 'copied' };
    } catch (error) {
      reasons.push(`clipboard:${errorCode(error)}`);
    }
    return { status: 'manual', reason: reasons.join(', ') };
  };

  if (!app?.shareMaxContent) return fallback();
  try {
    return Promise.resolve(app.shareMaxContent({ text, link }))
      .then((): ShareResult => ({ status: 'shared', via: 'max' }))
      .catch((error) => {
        reasons.push(`max:${errorCode(error)}`);
        return fallback();
      });
  } catch (error) {
    reasons.push(`max:${errorCode(error)}`);
    return fallback();
  }
};
