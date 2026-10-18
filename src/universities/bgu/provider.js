import { UnsupportedScheduleError } from '../provider.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { addDays, startOfWeek, toDateKey } from '../../lib/date.js';
import { parseGroups, parseTeachers, parseSchedule } from './parser.js';

// Одна очередь на процесс для всех экземпляров, групп и недель БГУ.
let queue = Promise.resolve();
let lastRequestAt = 0;
export class BguProvider {
  #inflight = new Map();
  #attempts = new Map();
  #cache = new Map();
  constructor({ cacheDir = './data/bgu-cache', intervalMs = 1500, ttlMs = 900_000, directoryTtlMs = 10_800_000, fetcher = fetch } = {}) {
    Object.assign(this, { cacheDir, intervalMs, ttlMs, directoryTtlMs, fetcher });
  }
  async #lock() {
    await mkdir(this.cacheDir, { recursive: true });
    const lock = join(this.cacheDir, '.request-lock');
    while (true) {
      try { await mkdir(lock); return () => rm(lock, { recursive: true, force: true }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try { if (Date.now() - (await stat(lock)).mtimeMs > 60_000) await rm(lock, { recursive: true, force: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await delay(100);
      }
    }
  }
  async #request(path) {
    const pending = queue.then(async () => {
      const release = await this.#lock();
      try {
        try { lastRequestAt = Math.max(lastRequestAt, Number(await readFile(join(this.cacheDir, '.last-request'), 'utf8')) || 0); } catch {}
        await delay(Math.max(0, this.intervalMs - (Date.now() - lastRequestAt)));
        lastRequestAt = Date.now();
        const response = await this.fetcher(new URL(path, 'https://bgu.ru'), {
          headers: { 'User-Agent': 'norfly/0.2 (student timetable; cache 15min; concurrency 1)', Accept: 'text/html' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`bgu_http_${response.status}`);
        return await response.text();
      } finally {
        try { await writeFile(join(this.cacheDir, '.last-request'), String(Date.now())); }
        finally { await release(); }
      }
    });
    queue = pending.catch(() => {});
    return pending;
  }
  async #cached(key, loader, fresh = false, ttl = this.ttlMs) {
    let entry = this.#cache.get(key);
    const path = join(this.cacheDir, `${createHash('sha256').update(`bgu:${key}`).digest('hex')}.json`);
    if (!entry) {
      try { entry = JSON.parse(await readFile(path, 'utf8')); this.#cache.set(key, entry); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (/^group:32982$/.test(key)) {
          entry = JSON.parse(await readFile(new URL('./saved/32982.json', import.meta.url), 'utf8'));
          this.#cache.set(key, entry);
        }
      }
    }
    const now = Date.now();
    if ((!entry || now - entry.savedAt >= ttl) && now - (this.#attempts.get(key) ?? 0) >= ttl && !this.#inflight.has(key)) {
      this.#attempts.set(key, now);
      const pending = loader().then(async (value) => {
        const next = { value, savedAt: Date.now() };
        await mkdir(this.cacheDir, { recursive: true });
        const temporaryPath = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, JSON.stringify(next));
        await rename(temporaryPath, path);
        this.#cache.set(key, next);
        return next;
      }).finally(() => this.#inflight.delete(key));
      pending.catch(() => {});
      this.#inflight.set(key, pending);
    }
    let stale = false;
    if ((!entry || fresh) && this.#inflight.has(key)) {
      try { entry = await this.#inflight.get(key); }
      catch (error) { if (!entry) throw error; stale = true; }
    }
    if (!entry) throw new Error('bgu_temporarily_unavailable');
    return { ...entry, stale: stale || Date.now() - entry.savedAt >= ttl };
  }
  async groups() { return (await this.#cached('groups', async () => parseGroups(await this.#request('/student/timetable.aspx')), false, this.directoryTtlMs)).value; }
  async institutes() { return []; }
  async teachers() { return (await this.#cached('teachers', async () => parseTeachers(await this.#request('/personal/timetable.aspx')), false, this.directoryTtlMs)).value; }
  async auditories() { return []; }
  async searchTeachers(query, { limit = 10 } = {}) { return (await this.teachers()).filter((item) => item.fullName.toLowerCase().replace(/ё/g, 'е').includes(String(query ?? '').toLowerCase().replace(/ё/g, 'е'))).slice(0, limit); }
  async searchAuditories() { return []; }
  async auditorySchedule() { throw new UnsupportedScheduleError(); }
  async searchGroups(query, { limit = 10 } = {}) {
    const compact = (value) => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-–—]+/g, '');
    return (await this.groups()).filter((group) => compact(group.title).includes(compact(query))).slice(0, limit);
  }
  async teacherSchedule(id, { week = new Date(), fresh = false } = {}) {
    const from = startOfWeek(week);
    const date = toDateKey(from).split('-').reverse().join('.');
    const entry = await this.#cached(`teacher:${id}:${toDateKey(from)}`, async () => {
      const html = await this.#request(`/telek/timetable-pps.aspx?idp=${id}&d=${date}`);
      parseSchedule(html, { week: from, teacherId: id });
      return html;
    }, fresh);
    return { kind: 'teacher', entityId: id, period: { from, to: addDays(from, 6) }, ...parseSchedule(entry.value, { week: from, teacherId: id }),
      stale: entry.stale, updatedAt: new Date(entry.savedAt).toISOString() };
  }
  async groupSchedule(id, { week = new Date(), fresh = false } = {}) {
    const from = startOfWeek(week);
    const key = `group:${id}`;
    const entry = await this.#cached(key, async () => {
      const html = await this.#request(`/telek/timetable.aspx?idg=${id}`);
      parseSchedule(html, { week: from, groupId: id });
      return html;
    }, fresh);
    return { kind: 'group', entityId: id, period: { from, to: addDays(from, 6) }, ...parseSchedule(entry.value, { week: from, groupId: id }),
      stale: entry.stale, updatedAt: new Date(entry.savedAt).toISOString() };
  }
}
