import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class CommunityStore {
  #data = { chats: {}, homework: [], notices: [] };
  #loaded = false;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async getChat(chatId) {
    await this.#load();
    return this.#data.chats[String(chatId)] ?? null;
  }

  async setChat(chatId, value) {
    await this.#load();
    const current = this.#data.chats[String(chatId)] ?? {};
    this.#data.chats[String(chatId)] = { ...current, ...value, chatId: Number(chatId) };
    await this.#queueSave();
    return this.#data.chats[String(chatId)];
  }

  async removeChat(chatId) {
    await this.#load();
    delete this.#data.chats[String(chatId)];
    await this.#queueSave();
  }

  async chatsForGroup(groupId) {
    await this.#load();
    return Object.values(this.#data.chats).filter((chat) => String(chat.group?.id) === String(groupId));
  }

  async addHomework(value) {
    await this.#load();
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...value };
    this.#data.homework.push(item);
    await this.#queueSave();
    return item;
  }

  async homeworkForGroup(groupId, { from = new Date() } = {}) {
    await this.#load();
    const fromKey = from.toISOString().slice(0, 10);
    return this.#data.homework
      .filter((item) => String(item.groupId) === String(groupId) && item.lessonDate >= fromKey)
      .sort((left, right) => `${left.lessonDate} ${left.lessonTime}`.localeCompare(`${right.lessonDate} ${right.lessonTime}`));
  }

  async addNotice(value) {
    await this.#load();
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'sent', ...value };
    this.#data.notices.push(item);
    await this.#queueSave();
    return item;
  }

  async #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents);
      this.#data = {
        chats: parsed.chats ?? {},
        homework: parsed.homework ?? [],
        notices: parsed.notices ?? [],
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async #queueSave() {
    this.#writeQueue = this.#writeQueue.then(() => this.#save());
    await this.#writeQueue;
  }

  async #save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.#data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
