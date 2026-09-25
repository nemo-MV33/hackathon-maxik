import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class CommunityStore {
  #data = { chats: {}, homework: [], personalHomework: [], notices: [] };
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

  async upsertHomework(value) {
    await this.#load();
    const now = new Date().toISOString();
    const index = this.#data.homework.findIndex((item) => this.#sameLesson(item, value));
    const current = index >= 0 ? this.#data.homework[index] : null;
    const item = {
      id: current?.id ?? randomUUID(),
      createdAt: current?.createdAt ?? now,
      ...current,
      ...value,
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
    };
    if (index >= 0) {
      this.#data.homework[index] = item;
      this.#data.homework = this.#data.homework.filter((candidate, candidateIndex) =>
        candidateIndex === index || !this.#sameLesson(candidate, value));
    } else this.#data.homework.push(item);
    await this.#queueSave();
    return item;
  }

  async addHomework(value) {
    return this.upsertHomework(value);
  }

  async removeHomework(value) {
    await this.#load();
    const before = this.#data.homework.length;
    this.#data.homework = this.#data.homework.filter((item) => !this.#sameLesson(item, value));
    if (this.#data.homework.length !== before) await this.#queueSave();
    return this.#data.homework.length !== before;
  }

  async homeworkForGroup(groupId, { from = new Date(), to, subgroup } = {}) {
    await this.#load();
    const fromKey = this.#dateKey(from);
    const toKey = to ? this.#dateKey(to) : null;
    const matching = this.#data.homework
      .filter((item) => String(item.groupId) === String(groupId) && item.lessonDate >= fromKey)
      .filter((item) => !toKey || item.lessonDate <= toKey)
      .filter((item) => !subgroup || !item.subgroup || item.subgroup === subgroup);
    const latest = new Map();
    for (const item of matching) latest.set(this.#lessonKey(item), item);
    return [...latest.values()].sort((left, right) =>
      `${left.lessonDate} ${left.lessonTime}`.localeCompare(`${right.lessonDate} ${right.lessonTime}`));
  }

  async setPersonalHomework(userId, value) {
    await this.#load();
    const now = new Date().toISOString();
    const target = { ...value, userId: Number(userId) };
    const index = this.#data.personalHomework.findIndex((item) =>
      String(item.userId) === String(userId) && this.#sameLesson(item, target));
    const current = index >= 0 ? this.#data.personalHomework[index] : null;
    const item = {
      id: current?.id ?? randomUUID(),
      createdAt: current?.createdAt ?? now,
      ...current,
      ...target,
      updatedAt: now,
    };
    if (index >= 0) this.#data.personalHomework[index] = item;
    else this.#data.personalHomework.push(item);
    await this.#queueSave();
    return item;
  }

  async removePersonalHomework(userId, value) {
    await this.#load();
    const before = this.#data.personalHomework.length;
    this.#data.personalHomework = this.#data.personalHomework.filter((item) =>
      !(String(item.userId) === String(userId) && this.#sameLesson(item, value)));
    if (this.#data.personalHomework.length !== before) await this.#queueSave();
    return this.#data.personalHomework.length !== before;
  }

  async homeworkForUser(groupId, userId, options = {}) {
    await this.#load();
    const shared = await this.homeworkForGroup(groupId, options);
    const fromKey = this.#dateKey(options.from ?? new Date());
    const toKey = options.to ? this.#dateKey(options.to) : null;
    const personal = this.#data.personalHomework
      .filter((item) => String(item.groupId) === String(groupId) && String(item.userId) === String(userId))
      .filter((item) => item.lessonDate >= fromKey && (!toKey || item.lessonDate <= toKey))
      .filter((item) => !options.subgroup || !item.subgroup || item.subgroup === options.subgroup);
    const keys = new Set([...shared, ...personal].map((item) => this.#lessonKey(item)));
    return [...keys].map((key) => {
      const common = shared.find((item) => this.#lessonKey(item) === key) ?? null;
      const own = personal.find((item) => this.#lessonKey(item) === key) ?? null;
      const source = own ? 'personal' : 'shared';
      return {
        ...(common ?? own),
        sharedText: common?.text ?? null,
        personalText: own?.text ?? null,
        text: own?.text ?? common?.text ?? '',
        source,
        updatedAt: own?.updatedAt ?? common?.updatedAt ?? common?.createdAt ?? own?.createdAt,
      };
    }).sort((left, right) =>
      `${left.lessonDate} ${left.lessonTime}`.localeCompare(`${right.lessonDate} ${right.lessonTime}`));
  }

  async homeworkRoleForGroup(groupId, userId) {
    const chats = await this.chatsForGroup(groupId);
    const actorId = String(userId);
    if (chats.some((chat) => String(chat.headman?.userId) === actorId)) return 'headman';
    if (chats.some((chat) => (chat.editors ?? []).some((editor) => String(editor.userId) === actorId))) return 'editor';
    if (chats.some((chat) => chat.homeworkMode === 'all')) return 'member';
    return 'student';
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
        personalHomework: parsed.personalHomework ?? [],
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

  #dateKey(value) {
    if (typeof value === 'string') return value.slice(0, 10);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  #lessonKey(value) {
    if (value.lessonNumber == null) {
      return [value.groupId, value.lessonDate, 'legacy', value.lessonTime, value.subgroup ?? 0, value.subject].join(':');
    }
    return [value.groupId, value.lessonDate, value.lessonNumber ?? '', value.subgroup ?? 0].join(':');
  }

  #sameLesson(left, right) {
    if (left.lessonNumber == null || right.lessonNumber == null) {
      return String(left.groupId) === String(right.groupId)
        && left.lessonDate === right.lessonDate
        && left.lessonTime === right.lessonTime
        && left.subject === right.subject
        && (left.subgroup ?? null) === (right.subgroup ?? null);
    }
    return this.#lessonKey(left) === this.#lessonKey(right);
  }
}
