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
};

declare global {
  interface Window {
    WebApp?: WebApp;
  }
}

export const webApp = (): WebApp | undefined => window.WebApp;
export const initData = (): string => window.WebApp?.initData ?? '';
export const currentUser = (): MaxUser | undefined => window.WebApp?.initDataUnsafe?.user;
