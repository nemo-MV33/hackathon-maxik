declare const __BUILD_ID__: string;

const RELOAD_KEY = 'norfly.reloadedFor';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const latestBuild = async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return null;
  return ((await response.json()) as { build?: string }).build ?? null;
};

const checkForUpdate = async () => {
  try {
    const build = await latestBuild();
    if (!build || build === __BUILD_ID__) return;
    if (sessionStorage.getItem(RELOAD_KEY) === build) return;
    sessionStorage.setItem(RELOAD_KEY, build);
    const url = new URL(window.location.href);
    url.searchParams.set('v', build);
    window.location.replace(url);
  } catch {}
};

export const watchForUpdates = () => {
  if (import.meta.env.DEV) return;
  void checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
};
