import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toDateKey } from '../lib/date.js';

export class IrnituApiError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'IrnituApiError';
    this.status = status;
  }
}

export class IrnituClient {
  #entries = new Map();
  #attempts = new Map();
  #active = 0;
  #waiting = [];
  #timestamps = new WeakMap();
  #inflight = new Map();

  constructor(options) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  groups() {
    return this.#directory('groups', 'group/');
  }

  teachers() {
    return this.#directory('teachers', 'teacher/');
  }

  auditories() {
    return this.#directory('auditories', 'auditory/');
  }

  groupSchedule(id, from, to, options = {}) {
    return this.#schedule('group', id, from, to, options);
  }

  teacherSchedule(id, from, to) {
    return this.#schedule('teacher', id, from, to);
  }

  auditorySchedule(id, from, to) {
    return this.#schedule('auditory', id, from, to);
  }

  async #directory(key, path) {
    return this.#cachedRequest(`directory:${key}`, path, this.options.directoryTtlMs);
  }

  async #schedule(kind, id, from, to, options = {}) {
    const query = new URLSearchParams({ dbeg: toDateKey(from), dend: toDateKey(to) });
    const path = `${kind}/${id}/schedule/?${query}`;
    const key = `schedule:${kind}:${id}:${query}`;
    return this.#cachedRequest(key, path, this.options.scheduleTtlMs, options);
  }

  updatedAt(payload) {
    return this.#timestamps.get(payload) ?? null;
  }

  async #cachedRequest(key, path, ttlMs, { fresh = false } = {}) {
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = await this.#readPersisted(key);
      // Параллельный запрос мог уже загрузить более свежие данные.
      entry = this.#entries.get(key) ?? entry;
      if (entry) this.#entries.set(key, entry);
    }
    const now = this.now();
    const stale = !entry || now - entry.savedAt >= ttlMs;
    const allowed = !this.#attempts.has(key) || now - this.#attempts.get(key) >= ttlMs;
    if (stale && allowed && !this.#inflight.has(key)) {
      this.#attempts.set(key, now);
      const pending = this.#request(path).then(async (value) => {
        const updated = { value, savedAt: this.now() };
        this.#entries.set(key, updated);
        this.#timestamps.set(value, new Date(updated.savedAt).toISOString());
        await this.#persist(key, value, updated.savedAt);
        return value;
      }).finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, pending);
      pending.catch(() => {});
    }
    if ((!entry || fresh) && this.#inflight.has(key)) {
      try { return await this.#inflight.get(key); }
      catch (error) { if (!entry) throw error; }
    }
    if (!entry) throw new IrnituApiError('Обновление расписания временно недоступно');
    this.#timestamps.set(entry.value, new Date(entry.savedAt).toISOString());
    return entry.value;
  }

  #cachePath(key) {
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.options.cacheDir, `${hash}.json`);
  }

  async #readPersisted(key) {
    try {
      const entry = JSON.parse(await readFile(this.#cachePath(key), 'utf8'));
      return entry.value === undefined ? undefined : { value: entry.value, savedAt: entry.savedAt ?? 0 };
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      return undefined;
    }
  }

  async #persist(key, value, savedAt) {
    await mkdir(this.options.cacheDir, { recursive: true });
    const path = this.#cachePath(key);
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ savedAt, value }));
    await rename(temporaryPath, path);
  }

  async #request(path) {
    if (this.#active >= (this.options.concurrency ?? 4)) await new Promise((resolve) => this.#waiting.push(resolve));
    else this.#active += 1;
    try { return await this.#fetch(path); }
    finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }

  async #fetch(path) {
    const url = new URL(path, this.options.baseUrl);
    let lastError;

    for (let attempt = 0; attempt < this.options.retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Token ${this.options.token}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (!response.ok) {
          const error = new IrnituApiError(`ИРНИТУ вернул HTTP ${response.status}`, {
            status: response.status,
          });
          if (response.status !== 429 && response.status < 500) throw error;
          lastError = error;
        } else {
          return await response.json();
        }
      } catch (error) {
        lastError = error;
        if (error instanceof IrnituApiError && error.status < 500 && error.status !== 429) {
          throw error;
        }
      }

      if (attempt + 1 < this.options.retries) {
        await delay(600 * 2 ** attempt);
      }
    }

    throw new IrnituApiError('Не удалось получить данные расписания ИРНИТУ', {
      cause: lastError,
      status: lastError?.status,
    });
  }
}
