const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  port: numberFromEnv('PORT', 3000),
  botToken: process.env.BOT_TOKEN?.trim() ?? '',
  apiAccessKey: process.env.API_ACCESS_KEY?.trim() ?? '',
  miniAppUrl: process.env.MINI_APP_URL?.trim() ?? '',
  irnitu: {
    baseUrl: process.env.IRNITU_API_URL?.trim() ?? 'https://schedule.istu.edu/api/',
    token: process.env.IRNITU_API_TOKEN?.trim() ?? '',
    timeoutMs: numberFromEnv('IRNITU_TIMEOUT_MS', 6_000),
    retries: numberFromEnv('IRNITU_RETRIES', 1),
    cacheDir: process.env.CACHE_DIR?.trim() ?? './data/cache',
    directoryTtlMs: numberFromEnv('DIRECTORY_CACHE_TTL_MS', 3 * 60 * 60 * 1000),
    scheduleTtlMs: numberFromEnv('SCHEDULE_CACHE_TTL_MS', 15 * 60 * 1000),
  },
};
