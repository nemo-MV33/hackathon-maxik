import { demoContext, demoAllowed, isDemo } from '../services/demo-service.js';
import { revisionEvent, versionSnapshot } from '../lib/homework-details.js';
import { HttpError } from '../http/routes/me.js';
import { groupKey, sameGroup, migrateGroupReferences } from '../universities/identity.js';
import { toDateKey } from '../lib/date.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Ключ ДЗ для просмотров: дата:номер пары:подгруппа (0 — вся группа).
export const homeworkViewKey = (item) => `${item.lessonDate}:${item.lessonNumber}:${item.subgroup ?? 0}`;

const visibleGroup = (id) => !demoContext.getStore() || !isDemo(id) || demoAllowed();
// Чат, из которого бота удалили, хранится с отметкой removedAt и ролей не даёт.
const activeChat = (chat) => !chat.removedAt && visibleGroup(chat.group?.id);

export class CommunityStore {
  #data = { chats: {}, homework: [], personalHomework: [], notices: [], announcements: [], lessonChanges: [], scheduleOperations: [], homeworkViews: [] };
  #loadPromise;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async attachmentRecords() {
    await this.#load();
    return [...this.#data.homework, ...this.#data.personalHomework];
  }

  async resetGroup(groupId) {
    await this.#load();
    for (const name of ['homework', 'personalHomework', 'notices', 'announcements', 'lessonChanges', 'homeworkViews']) {
      this.#data[name] = this.#data[name].filter((item) => !sameGroup(item.groupId, groupId));
    }
    this.#data.scheduleOperations = this.#data.scheduleOperations.filter((id) => !id.startsWith(`${groupKey(groupId)}:`));
    for (const [id, chat] of Object.entries(this.#data.chats)) if (sameGroup(chat.group?.id, groupId)) delete this.#data.chats[id];
    await this.#queueSave();
    await this.attachmentStore?.reconcile({ removeGroup: groupId });
  }

  async getChat(chatId) {
    await this.#load();
    const chat = this.#data.chats[String(chatId)];
    return chat && activeChat(chat) ? chat : null;
  }

  async setChat(chatId, value) {
    await this.#load();
    const current = this.#data.chats[String(chatId)] ?? {};
    this.#data.chats[String(chatId)] = { ...current, ...migrateGroupReferences(value), chatId: Number(chatId) };
    // Бот снова пишет в чат, значит его вернули, даже если событие bot_added потерялось.
    delete this.#data.chats[String(chatId)].removedAt;
    await this.#queueSave();
    return this.#data.chats[String(chatId)];
  }

  // Бота удалили из чата: группу, старосту и редакторов откладываем до возвращения бота.
  async removeChat(chatId) {
    await this.#load();
    const chat = this.#data.chats[String(chatId)];
    if (!chat) return;
    if (chat.group) chat.removedAt = new Date().toISOString();
    else delete this.#data.chats[String(chatId)];
    await this.#queueSave();
  }

  async restoreChat(chatId) {
    await this.#load();
    const chat = this.#data.chats[String(chatId)];
    if (!chat?.removedAt) return null;
    delete chat.removedAt;
    await this.#queueSave();
    return visibleGroup(chat.group?.id) ? chat : null;
  }

  async chatsForGroup(groupId) {
    await this.#load();
    return Object.values(this.#data.chats).filter(activeChat).filter((chat) => sameGroup(chat.group?.id, groupId));
  }

  async allChats() {
    await this.#load();
    return Object.values(this.#data.chats).filter(activeChat);
  }

  async scheduleOperationApplied(id) {
    await this.#load();
    return this.#data.scheduleOperations.includes(id);
  }

  async recordScheduleOperation(id) {
    await this.#load();
    if (this.#data.scheduleOperations.includes(id)) return;
    this.#data.scheduleOperations.push(id);
    await this.#queueSave();
  }

  async lessonChanges(groupId) {
    await this.#load();
    return this.#data.lessonChanges.filter((item) => sameGroup(item.groupId, groupId));
  }

  async saveLessonChange(value) {
    value = migrateGroupReferences(value);
    await this.#load();
    const current = this.#data.lessonChanges.find((item) => item.id === value.id);
    if (current) Object.assign(current, value);
    else this.#data.lessonChanges.push(value);
    await this.#queueSave();
    return current ?? value;
  }

  async orphanedLessons(groupId) {
    await this.#load();
    const lessons = new Map();
    for (const item of [...this.#data.homework, ...this.#data.personalHomework]) {
      if (!sameGroup(item.groupId, groupId) || item.status !== 'orphaned') continue;
      const from = item.history?.findLast((event) => event.type === 'orphaned')?.from;
      if (from) lessons.set(this.#lessonKey(item), from);
    }
    return [...lessons.values()];
  }

  async orphanedHomework(groupId) {
    await this.#load();
    return this.#data.homework.filter((item) => sameGroup(item.groupId, groupId) && item.status === 'orphaned');
  }

  // Изменение слота и история сохраняются одним атомарным обновлением JSON.
  async relocateHomework(groupId, from, to, { id, at = new Date().toISOString(), by = 'schedule', authorId, authorName } = {}) {
    await this.#load();
    let changed = false;
    for (const collection of ['homework', 'personalHomework']) {
      for (const item of this.#data[collection]) {
        if (!this.#sameLesson(item, { groupId, lessonDate: from.date, lessonTime: from.time, ...from })) continue;
        if ((item.history ?? []).some((event) => event.id === id)) continue;
        item.history = [...(item.history ?? []), { id, type: to ? 'moved' : 'orphaned', from, to, at, by, authorId, authorName, version: (item.version ?? 1) + 1, before: versionSnapshot(item) }];
        item.status = to ? 'active' : 'orphaned';
        const viewKey = homeworkViewKey(item);
        if (to) Object.assign(item, { lessonDate: to.date, lessonNumber: to.lessonNumber, lessonTime: to.time, subgroup: to.subgroup ?? null });
        // Просмотры общего ДЗ переезжают вместе с ним.
        if (to && collection === 'homework') this.#moveViews(item.groupId, viewKey, homeworkViewKey(item));
        item.updatedAt = at;
        item.version = (item.version ?? 1) + 1;
        item.history.at(-1).after = versionSnapshot(item);
        changed = true;
      }
      // В целевом слоте может уже быть ДЗ. Сохраняем оба текста и историю.
      const unique = new Map();
      for (const item of this.#data[collection]) {
        const key = `${this.#lessonKey(item)}:${item.userId ?? ''}`;
        const previous = unique.get(key);
        if (!previous) unique.set(key, item);
        else {
          item.text = [...new Set([previous.text, item.text].filter(Boolean))].join('\n\n');
          item.history = [...(previous.history ?? []), ...(item.history ?? [])];
          item.attachments = [...new Map([...(previous.attachments ?? []), ...(item.attachments ?? [])].map((file) => [file.id, file])).values()];
          let revision = 0;
          item.history = item.history.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''))).map((event) => ({ ...event,
            ...(event.version ? { originalVersion: event.originalVersion ?? event.version } : {}), version: event.after ? ++revision : undefined,
          }));
          item.version = Math.max(previous.version ?? 1, item.version ?? 1, revision) + 1;
          item.history.push(revisionEvent(null, item, { type: 'merged' }));
          unique.set(key, item);
        }
      }
      this.#data[collection] = [...unique.values()];
    }
    if (changed) await this.#queueSave();
    return changed;
  }

  async upsertHomework(value) {
    value = migrateGroupReferences(value);
    await this.#load();
    const now = new Date().toISOString();
    const index = this.#data.homework.findIndex((item) => this.#sameLesson(item, value));
    const current = index >= 0 ? this.#data.homework[index] : null;
    const item = {
      id: current?.id ?? randomUUID(),
      createdAt: current?.createdAt ?? now,
      ...current,
      ...value,
      attachments: value.attachments ?? current?.attachments ?? [],
      history: this.#attachmentHistory(current, value, now),
      status: value.status ?? current?.status ?? 'active',
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
    };
    if (current && !(current.history ?? []).some((event) => event.after)) item.history = [...(item.history ?? []), revisionEvent(null, current, { type: 'baseline' })];
    item.history = [...(item.history ?? []), revisionEvent(current, item, value.restoredFrom ? { restoredFrom: value.restoredFrom } : {})];
    delete item.restoredFrom;
    if (index >= 0) {
      this.#data.homework[index] = item;
      this.#data.homework = this.#data.homework.filter((candidate, candidateIndex) =>
        candidateIndex === index || !this.#sameLesson(candidate, value));
    } else this.#data.homework.push(item);
    await this.#queueSave();
    return item;
  }

  async restoreHomework(groupId, userId, target, version, authorName) {
    const role = await this.homeworkRoleForGroup(groupId, userId);
    if (!['headman', 'editor'].includes(role)) throw new HttpError(403, 'homework_forbidden');
    const current = (await this.attachmentRecords()).find((item) => item.userId == null && this.#sameLesson(item, { ...target, groupId }));
    if (!current) throw new HttpError(404, 'homework_not_found');
    const event = (current.history ?? []).find((item) => item.version === version && item.after);
    // У старых записей нет снимков версий: прежний текст не выдумываем и файлы молча не теряем.
    const snapshot = event?.after;
    if (!snapshot || version >= current.version) throw new HttpError(409, 'version_unavailable');
    for (const file of snapshot.attachments ?? []) {
      try { await this.attachmentStore.metadata(file.id); }
      catch { throw new HttpError(409, 'version_attachments_removed', 'Файлы этой версии удалены; полный возврат невозможен'); }
    }
    return this.upsertHomework({ ...current, ...snapshot, authorId: userId, authorName, restoredFrom: version });
  }

  async addHomework(value) {
    return this.upsertHomework(value);
  }

  async removeHomework(value) {
    await this.#load();
    const before = this.#data.homework.length;
    this.#data.homework = this.#data.homework.filter((item) => !this.#sameLesson(item, value));
    // Новое ДЗ в том же слоте считается заново.
    if (value.lessonNumber != null) {
      this.#data.homeworkViews = this.#data.homeworkViews.filter((view) => !(sameGroup(view.groupId, value.groupId) && view.key === homeworkViewKey(value)));
    }
    if (this.#data.homework.length !== before) await this.#queueSave();
    return this.#data.homework.length !== before;
  }

  async homeworkForGroup(groupId, { from = new Date(), to, subgroup } = {}) {
    await this.#load();
    const fromKey = this.#dateKey(from);
    const toKey = to ? this.#dateKey(to) : null;
    const matching = this.#data.homework
      .filter((item) => sameGroup(item.groupId, groupId) && item.lessonDate >= fromKey)
      .filter((item) => !toKey || item.lessonDate <= toKey)
      .filter((item) => !subgroup || !item.subgroup || item.subgroup === subgroup);
    const latest = new Map();
    for (const item of matching) latest.set(this.#lessonKey(item), item);
    return [...latest.values()].sort((left, right) =>
      `${left.lessonDate} ${left.lessonTime}`.localeCompare(`${right.lessonDate} ${right.lessonTime}`));
  }

  // Первый просмотр общего ДЗ студентом. Повторные открытия время не сдвигают.
  async recordHomeworkView({ userId, groupId, key, at = new Date().toISOString() }) {
    await this.#load();
    if (this.#data.homeworkViews.some((view) => String(view.userId) === String(userId) && sameGroup(view.groupId, groupId) && view.key === key)) return false;
    this.#data.homeworkViews.push(migrateGroupReferences({ userId: Number(userId), groupId, key, viewedAt: at }));
    await this.#queueSave();
    return true;
  }

  async homeworkViewers(groupId, key) {
    await this.#load();
    return new Set(this.#data.homeworkViews
      .filter((view) => sameGroup(view.groupId, groupId) && view.key === key)
      .map((view) => String(view.userId)));
  }

  // Медиана от публикации ДЗ до первого просмотра каждым студентом. Автор ДЗ не учитывается.
  async homeworkViewStats(groupId, { now = new Date(), days = 14 } = {}) {
    await this.#load();
    const since = now.getTime() - days * 86_400_000;
    const published = this.#data.homework.filter((item) => sameGroup(item.groupId, groupId) && item.lessonNumber != null
      && Date.parse(item.createdAt ?? item.updatedAt) >= since && Date.parse(item.createdAt ?? item.updatedAt) <= now.getTime());
    const delays = [];
    for (const item of published) {
      const start = Date.parse(item.createdAt ?? item.updatedAt);
      for (const view of this.#data.homeworkViews) {
        if (!sameGroup(view.groupId, groupId) || view.key !== homeworkViewKey(item) || String(view.userId) === String(item.authorId)) continue;
        const delay = Date.parse(view.viewedAt) - start;
        if (delay >= 0) delays.push(delay);
      }
    }
    delays.sort((left, right) => left - right);
    const middle = Math.floor(delays.length / 2);
    const median = delays.length ? (delays.length % 2 ? delays[middle] : (delays[middle - 1] + delays[middle]) / 2) : null;
    return { days, homework: published.length, views: delays.length, medianMinutes: median === null ? null : Math.round(median / 60_000) };
  }

  async setPersonalHomework(userId, value) {
    value = migrateGroupReferences(value);
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
      attachments: value.attachments ?? current?.attachments ?? [],
      history: this.#attachmentHistory(current, value, now),
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
    };
    if (current && !(current.history ?? []).some((event) => event.after)) item.history = [...(item.history ?? []), revisionEvent(null, current, { type: 'baseline' })];
    item.history = [...(item.history ?? []), revisionEvent(current, item)];
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
      .filter((item) => sameGroup(item.groupId, groupId) && String(item.userId) === String(userId))
      .filter((item) => item.lessonDate >= fromKey && (!toKey || item.lessonDate <= toKey))
      .filter((item) => !options.subgroup || !item.subgroup || item.subgroup === options.subgroup);
    const keys = new Set([...shared, ...personal].map((item) => this.#lessonKey(item)));
    return [...keys].map((key) => {
      const common = shared.find((item) => this.#lessonKey(item) === key) ?? null;
      const own = personal.find((item) => this.#lessonKey(item) === key) ?? null;
      const source = own ? 'personal' : 'shared';
      return {
        ...(own ?? common),
        sharedDeadline: common?.deadline ?? { kind: 'lesson' },
        personalDeadline: own?.deadline ?? { kind: 'lesson' },
        sharedSubmission: common?.submission ?? null,
        personalSubmission: own?.submission ?? null,
        sharedHistory: common?.history ?? [],
        personalHistory: own?.history ?? [],
        sharedAttachments: common?.attachments ?? [],
        personalAttachments: own?.attachments ?? [],
        attachments: own?.attachments ?? common?.attachments ?? [],
        sharedAuthorName: common?.authorName ?? null,
        sharedUpdatedAt: common?.updatedAt ?? null,
        sharedVersion: common?.version ?? 1,
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
    value = migrateGroupReferences(value);
    await this.#load();
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'sent', ...value };
    this.#data.notices.push(item);
    await this.#queueSave();
    return item;
  }

  async pendingNoticesForHeadman(userId) {
    await this.#load();
    const chatIds = new Set(Object.values(this.#data.chats)
      .filter((chat) => !chat.removedAt && String(chat.headman?.userId) === String(userId))
      .map((chat) => String(chat.chatId)));
    return this.#data.notices.filter((item) => item.status === 'pending' && chatIds.has(String(item.chatId)));
  }

  async getNotice(id) {
    await this.#load();
    return this.#data.notices.find((item) => item.id === id) ?? null;
  }

  async acceptNotice(id) {
    await this.#load();
    const item = this.#data.notices.find((candidate) => candidate.id === id);
    if (!item) return null;
    if (!item.acceptedAt) {
      item.acceptedAt = new Date().toISOString();
      await this.#queueSave();
    }
    return item;
  }

  // Сообщения об опоздании за день: для старосты — вся группа, для студента — только свои.
  async noticesForDay(groupId, dateKey, { senderId } = {}) {
    await this.#load();
    return this.#data.notices
      .filter((item) => sameGroup(item.groupId, groupId))
      .filter((item) => (item.date ?? item.lesson?.date ?? item.createdAt?.slice(0, 10)) === dateKey)
      .filter((item) => senderId === undefined || String(item.senderId) === String(senderId))
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  // С groupId — только чаты этой группы: роль в чате другой группы в своей группе не действует.
  // null — группа в профиле не выбрана, конфликта нет: подходят все чаты.
  async chatsWithRole(userId, groupId) {
    await this.#load();
    const id = String(userId);
    return Object.values(this.#data.chats).filter(activeChat).filter((chat) => chat.group && (
      String(chat.headman?.userId) === id || (chat.editors ?? []).some((editor) => String(editor.userId) === id)
    )).filter((chat) => groupId == null || sameGroup(chat.group.id, groupId));
  }

  async headmanChat(userId, groupId) {
    return (await this.chatsWithRole(userId, groupId)).find((chat) => String(chat.headman?.userId) === String(userId)) ?? null;
  }

  // Вся история сообщений группы — для «досье» старосты; с senderId — только свои.
  async noticesForGroup(groupId, { senderId } = {}) {
    await this.#load();
    return this.#data.notices
      .filter((item) => sameGroup(item.groupId, groupId))
      .filter((item) => senderId === undefined || String(item.senderId) === String(senderId))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  // Объявления старосты: живут, пока не прошла дата события (или 14 дней без даты).
  async addAnnouncement(value) {
    value = migrateGroupReferences(value);
    await this.#load();
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...value };
    this.#data.announcements.push(item);
    await this.#queueSave();
    return item;
  }

  async getAnnouncement(id) {
    await this.#load();
    return this.#data.announcements.find((item) => item.id === id) ?? null;
  }

  async updateAnnouncement(id, patch) {
    await this.#load();
    const item = this.#data.announcements.find((candidate) => candidate.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    await this.#queueSave();
    return item;
  }

  async removeAnnouncement(id) {
    await this.#load();
    const before = this.#data.announcements.length;
    this.#data.announcements = this.#data.announcements.filter((item) => item.id !== id);
    if (before !== this.#data.announcements.length) await this.#queueSave();
    return before !== this.#data.announcements.length;
  }

  async announcementsForGroup(groupId, { now = new Date() } = {}) {
    await this.#load();
    const keepUntil = (item) => new Date(item.remindAt ?? item.createdAt).getTime() + (item.remindAt ? 86_400_000 : 14 * 86_400_000);
    return this.#data.announcements
      .filter((item) => sameGroup(item.groupId, groupId) && keepUntil(item) > now.getTime())
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async allAnnouncements() {
    await this.#load();
    return this.#data.announcements.filter((item) => visibleGroup(item.groupId));
  }

  // Удаление аккаунта студента. Сообщения об опозданиях остаются у старосты (это журнал группы),
  // а роль старосты освобождается: история группы перейдёт новому старосте, потому что хранится по группе.
  async removeUser(userId) {
    await this.#load();
    const id = String(userId);
    this.#data.personalHomework = this.#data.personalHomework.filter((item) => String(item.userId) !== id);
    this.#data.homeworkViews = this.#data.homeworkViews.filter((view) => String(view.userId) !== id);
    for (const chat of Object.values(this.#data.chats)) {
      if (String(chat.headman?.userId) === id) chat.headman = null;
      if (String(chat.deputy?.userId) === id) chat.deputy = null;
      if (chat.editors?.some((editor) => String(editor.userId) === id)) {
        chat.editors = chat.editors.filter((editor) => String(editor.userId) !== id);
      }
    }
    await this.#queueSave();
    await this.attachmentStore?.reconcile({ removeUser: userId });
  }

  async markNoticeSent(id) {
    await this.#load();
    const item = this.#data.notices.find((candidate) => candidate.id === id);
    if (!item) return null;
    item.status = 'sent';
    item.deliveredAt = new Date().toISOString();
    await this.#queueSave();
    return item;
  }

  async #load() {
    if (!this.#loadPromise) this.#loadPromise = this.#read().catch((error) => { this.#loadPromise = undefined; throw error; });
    return this.#loadPromise;
  }

  async #read() {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = migrateGroupReferences(JSON.parse(contents));
      if ((parsed.schemaVersion ?? 1) > 4) throw new Error('Unsupported community schemaVersion');
      this.#data = {
        ...parsed,
        schemaVersion: 4,
        chats: parsed.chats ?? {},
        homework: (parsed.homework ?? []).map((item) => ({ ...item, attachments: item.attachments ?? [] })),
        personalHomework: (parsed.personalHomework ?? []).map((item) => ({ ...item, attachments: item.attachments ?? [] })),
        notices: parsed.notices ?? [],
        announcements: parsed.announcements ?? [],
        lessonChanges: parsed.lessonChanges ?? [],
        scheduleOperations: parsed.scheduleOperations ?? [],
        // Поле появилось без смены схемы: в старых файлах его просто нет.
        homeworkViews: parsed.homeworkViews ?? [],
      };
      if (JSON.parse(contents).schemaVersion !== 4) await this.#save();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async #queueSave() {
    const saving = this.#writeQueue.then(() => this.#save());
    this.#writeQueue = saving.catch(() => {});
    await saving;
    await this.attachmentStore?.reconcile();
  }

  async #save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ ...migrateGroupReferences(this.#data), schemaVersion: 4 }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  #attachmentHistory(current, value, at) {
    const before = current?.attachments ?? [];
    const after = value.attachments ?? before;
    const added = after.filter((file) => !before.some((old) => old.id === file.id));
    const removed = before.filter((file) => !after.some((next) => next.id === file.id));
    if (!added.length && !removed.length) return current?.history;
    return [...(current?.history ?? []), ...(added.length || removed.length ? [{ type: 'attachments', at, by: value.authorId ?? value.userId, authorName: value.authorName ?? null, added, removed }] : [])];
  }

  // При слиянии слотов у студента остаётся самый ранний просмотр.
  #moveViews(groupId, from, to) {
    if (from === to) return;
    const earliest = new Map();
    for (const view of this.#data.homeworkViews) {
      if (sameGroup(view.groupId, groupId) && view.key === from) view.key = to;
      if (!sameGroup(view.groupId, groupId) || view.key !== to) continue;
      const previous = earliest.get(String(view.userId));
      if (!previous || view.viewedAt < previous.viewedAt) earliest.set(String(view.userId), view);
    }
    this.#data.homeworkViews = this.#data.homeworkViews.filter((view) =>
      !sameGroup(view.groupId, groupId) || view.key !== to || earliest.get(String(view.userId)) === view);
  }

  #dateKey(value) {
    if (typeof value === 'string') return value.slice(0, 10);
    return toDateKey(value);
  }

  #lessonKey(value) {
    if (value.lessonNumber == null) {
      return [groupKey(value.groupId), value.lessonDate, 'legacy', value.lessonTime, value.subgroup ?? 0, value.subject].join(':');
    }
    return [groupKey(value.groupId), value.lessonDate, value.lessonNumber ?? '', value.subgroup ?? 0].join(':');
  }

  #sameLesson(left, right) {
    if (left.lessonNumber == null || right.lessonNumber == null) {
      return sameGroup(left.groupId, right.groupId)
        && left.lessonDate === right.lessonDate
        && left.lessonTime === right.lessonTime
        && left.subject === right.subject
        && (left.subgroup ?? null) === (right.subgroup ?? null);
    }
    return this.#lessonKey(left) === this.#lessonKey(right);
  }
}
