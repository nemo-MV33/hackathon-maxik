import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class PreferencesStore {
  #items = new Map();
  #loaded = false;
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
    this.#items.set(String(userId), value);
    this.#writeQueue = this.#writeQueue.then(() => this.#save());
    await this.#writeQueue;
    return value;
  }

  async entries() {
    await this.#load();
    return [...this.#items.entries()];
  }

  async #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const contents = await readFile(this.filePath, 'utf8');
      this.#items = new Map(Object.entries(JSON.parse(contents)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async #save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const contents = JSON.stringify(Object.fromEntries(this.#items), null, 2);
    await writeFile(temporaryPath, `${contents}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
