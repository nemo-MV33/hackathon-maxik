import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MemoryCache } from '../lib/cache.js';
import { toDateKey } from '../lib/date.js';

export class IrnituApiError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'IrnituApiError';
    this.status = status;
  }
}

export class IrnituClient {
  #cache = new MemoryCache();
  #inflight = new Map();

  constructor(options) {
    this.options = options;
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

  groupSchedule(id, from, to) {
    return this.#schedule('group', id, from, to);
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

  async #schedule(kind, id, from, to) {
    const query = new URLSearchParams({ dbeg: toDateKey(from), dend: toDateKey(to) });
    const path = `${kind}/${id}/schedule/?${query}`;
    const key = `schedule:${kind}:${id}:${query}`;
    return this.#cachedRequest(key, path, this.options.scheduleTtlMs);
  }

  async #cachedRequest(key, path, ttlMs) {
    const fresh = this.#cache.get(key);
    if (fresh) return fresh;
    const persisted = await this.#readPersisted(key);
    if (persisted !== undefined) {
      this.#cache.set(key, persisted, ttlMs);
      this.#refreshInBackground(key, path, ttlMs);
      return persisted;
    }
    if (this.#inflight.has(key)) return this.#inflight.get(key);

    const request = this.#request(path)
      .then(async (value) => {
        this.#cache.set(key, value, ttlMs);
        await this.#persist(key, value);
        return value;
      })
      .catch((error) => {
        const stale = this.#cache.get(key, { allowStale: true });
        if (stale) return stale;
        throw error;
      })
      .finally(() => this.#inflight.delete(key));

    this.#inflight.set(key, request);
    return request;
  }

  #refreshInBackground(key, path, ttlMs) {
    if (this.#inflight.has(key)) return;
    const request = this.#request(path)
      .then(async (value) => {
        this.#cache.set(key, value, ttlMs);
        await this.#persist(key, value);
      })
      .catch(() => {})
      .finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, request);
  }

  #cachePath(key) {
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.options.cacheDir, `${hash}.json`);
  }

  async #readPersisted(key) {
    try {
      return JSON.parse(await readFile(this.#cachePath(key), 'utf8')).value;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      return undefined;
    }
  }

  async #persist(key, value) {
    await mkdir(this.options.cacheDir, { recursive: true });
    const path = this.#cachePath(key);
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ savedAt: Date.now(), value }));
    await rename(temporaryPath, path);
  }

  async #request(path) {
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
