import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export class SourceError extends Error {
  constructor(code, { status, cause } = {}) {
    super(code, { cause });
    this.name = 'SourceError';
    this.code = code;
    this.status = status;
  }
}

// Открытый JSON API вуза: очередь запросов, кэш в памяти и на диске.
// При сбое источника отдаётся последний успешный ответ с исходным временем загрузки.
export class JsonSource {
  #entries = new Map();
  #attempts = new Map();
  #inflight = new Map();
  #active = 0;
  #waiting = [];
  #nextStart = 0;
  #blockedUntil = 0;

  constructor({ id, baseUrl, cacheDir, concurrency = 2, intervalMs = 0, timeoutMs = 15_000, retries = 2, fetcher = fetch, now = Date.now }) {
    Object.assign(this, { id, baseUrl, cacheDir, concurrency, intervalMs, timeoutMs, retries, fetcher, now });
  }

  async get(path, { ttlMs, fresh = false }) {
    const key = `${this.id}:${path}`;
    let entry = this.#entries.get(key) ?? await this.#read(key);
    if (entry) this.#entries.set(key, entry);
    const now = this.now();
    const outdated = !entry || now - entry.savedAt >= ttlMs;
    // После долгого 429 источник не трогаем до конца блокировки: каждый запрос продлевал бы её.
    const allowed = now >= this.#blockedUntil && now - (this.#attempts.get(key) ?? 0) >= Math.min(ttlMs, 60_000);
    if ((outdated || fresh) && allowed && !this.#inflight.has(key)) {
      this.#attempts.set(key, now);
      const pending = this.#request(path).then(async (value) => {
        const next = { value, savedAt: this.now() };
        this.#entries.set(key, next);
        await this.#write(key, next).catch(() => {});
        return next;
      }).finally(() => this.#inflight.delete(key));
      pending.catch(() => {});
      this.#inflight.set(key, pending);
    }
    if ((!entry || fresh) && this.#inflight.has(key)) {
      try { entry = await this.#inflight.get(key); }
      catch (error) { if (!entry) throw error; }
    }
    if (!entry) throw new SourceError(`${this.id}_temporarily_unavailable`);
    return { ...entry, stale: this.now() - entry.savedAt >= ttlMs };
  }

  #path(key) {
    return join(this.cacheDir, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  async #read(key) {
    try { return JSON.parse(await readFile(this.#path(key), 'utf8')); }
    catch { return undefined; }
  }

  async #write(key, entry) {
    await mkdir(this.cacheDir, { recursive: true });
    const temporary = `${this.#path(key)}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry));
    await rename(temporary, this.#path(key));
  }

  async #request(path) {
    if (this.#active >= this.concurrency) await new Promise((resolve) => this.#waiting.push(resolve));
    else this.#active += 1;
    try {
      // Пауза между запросами: открытые API вузов ограничивают частоту и отвечают 429.
      const wait = this.#nextStart - Date.now();
      this.#nextStart = Math.max(Date.now(), this.#nextStart) + this.intervalMs;
      if (wait > 0) await delay(wait);
      if (this.now() < this.#blockedUntil) throw new SourceError(`${this.id}_http_429`, { status: 429 });
      return await this.#fetch(path);
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }

  async #fetch(path) {
    let lastError;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        const response = await this.fetcher(new URL(path, this.baseUrl), {
          headers: { Accept: 'application/json', 'User-Agent': 'norfly/0.3 (student timetable; cache 15min)' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.ok) return await response.json();
        lastError = new SourceError(`${this.id}_http_${response.status}`, { status: response.status });
        // 4xx кроме 429 не исправится повтором.
        if (response.status < 500 && response.status !== 429) throw lastError;
        if (response.status === 429) {
          const retryAfter = Number(response.headers?.get?.('retry-after')) * 1000;
          // Суточная квота (у СПбГУ Retry-After около 24 ч): ждать бессмысленно, отвечаем из кэша.
          if (retryAfter > 60_000) { this.#blockedUntil = this.now() + retryAfter; throw lastError; }
          if (attempt + 1 < this.retries) { await delay(retryAfter > 0 ? retryAfter : 5_000 * (attempt + 1)); continue; }
        }
      } catch (error) {
        lastError = error;
        if (error instanceof SourceError && error.status < 500 && (error.status !== 429 || this.now() < this.#blockedUntil)) throw error;
      }
      if (attempt + 1 < this.retries) await delay(500 * 2 ** attempt);
    }
    throw new SourceError(`${this.id}_unavailable`, { cause: lastError, status: lastError?.status });
  }
}

// Номер пары по таблице звонков вуза. Нестандартное начало получает номер
// после всех слотов, чтобы ключ ДЗ оставался устойчивым и сортировка — верной.
export const slotNumber = (times, start) => {
  const known = Object.entries(times).find(([, time]) => time.startsWith(start));
  if (known) return Number(known[0]);
  const [hour, minute] = start.split(':').map(Number);
  return 1000 + hour * 60 + minute;
};

export const clockTime = (value) => {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};

export const normalizeLessonType = (value) => {
  const text = String(value ?? '').toLowerCase();
  if (/лаборатор/.test(text)) return 'лабораторная';
  if (/экзамен/.test(text)) return 'экзамен';
  if (/зач[её]т/.test(text)) return 'зачёт';
  if (/консульт/.test(text)) return 'консультация';
  if (/лекци/.test(text)) return 'лекция';
  if (/практи|семинар/.test(text)) return 'практика';
  return text.trim() || 'занятие';
};

export const compactSearch = (value) => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-–—/_]+/g, '');
