import { migrateGroupReferences } from '../universities/identity.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class PreferencesStore {
  #items = new Map();
  #loadPromise;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async get(userId) {
    await this.#load();
    return this.#items.get(String(userId)) ?? {};
  }

  async set(userId, value) {
    await this.#load();
    value = migrateGroupReferences(value);
    this.#items.set(String(userId), value);
    this.#writeQueue = this.#writeQueue.then(() => this.#save());
    await this.#writeQueue;
    return value;
  }

  // Удаление аккаунта: профиль, настройки и отметки об отправленных уведомлениях исчезают целиком.
  async delete(userId) {
    await this.#load();
    const existed = this.#items.delete(String(userId));
    this.#writeQueue = this.#writeQueue.then(() => this.#save());
    await this.#writeQueue;
    return existed;
  }

  async entries() {
    await this.#load();
    return [...this.#items.entries()];
  }

  async #load() {
    if (!this.#loadPromise) this.#loadPromise = this.#read().catch((error) => { this.#loadPromise = undefined; throw error; });
    return this.#loadPromise;
  }

  async #read() {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents);
      this.#items = new Map(Object.entries(migrateGroupReferences(parsed.profiles ?? parsed)).filter(([key]) => key !== 'schemaVersion'));
      if (parsed.schemaVersion !== 3) await this.#save();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async #save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const contents = JSON.stringify({ schemaVersion: 3, profiles: Object.fromEntries(this.#items) }, null, 2);
    await writeFile(temporaryPath, `${contents}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
