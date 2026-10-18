import { mkdir, readFile, writeFile, rename, readdir, unlink, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { groupKey, sameGroup } from '../universities/identity.js';
import { HttpError } from '../http/routes/me.js';

const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
export const attachmentLimits = () => ({
  fileBytes: positive(process.env.ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024),
  count: positive(process.env.ATTACHMENT_MAX_COUNT, 8),
  totalBytes: positive(process.env.ATTACHMENT_TOTAL_BYTES, 5 * 1024 * 1024 * 1024),
  groupBytes: positive(process.env.ATTACHMENT_GROUP_BYTES, 100 * 1024 * 1024),
  reserveBytes: positive(process.env.ATTACHMENT_RESERVE_BYTES, 512 * 1024 * 1024),
});
const ID = /^[a-f0-9-]{36}$/;
const ALLOWED = new Set(['jpg', 'png', 'webp', 'gif', 'bmp', 'tif', 'heic', 'avif', 'pdf', 'doc', 'xls', 'ppt', 'docx', 'xlsx', 'pptx', 'rtf', 'zip', '7z', 'gz', 'tar', 'rar', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'ogg', 'opus', 'm4a', 'flac']);
export const cleanFilename = (name) => String(name || 'file').normalize('NFC').replace(/[\/\\<>:"|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^\.+/, '').slice(0, 160) || 'file';
export const detectAttachmentType = async (bytes) => {
  const type = await fileTypeFromBuffer(bytes).catch(() => null);
  if (type && ALLOWED.has(type.ext)) return type;
  if (type?.ext === 'cfb') {
    for (const [stream, ext, mime] of [['WordDocument', 'doc', 'application/msword'], ['Workbook', 'xls', 'application/vnd.ms-excel'], ['PowerPoint Document', 'ppt', 'application/vnd.ms-powerpoint']]) {
      if (bytes.includes(Buffer.from(stream, 'utf16le'))) return { ext, mime };
    }
  }
  // UTF-8 text only. Active HTML/XML/SVG are deliberately excluded.
  if (!type && bytes.length) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) && !/<[!?a-z/]/i.test(text)) return { ext: 'txt', mime: 'text/plain' };
    } catch {}
  }
  throw new HttpError(415, 'attachment_type', 'Тип файла не поддерживается / Unsupported file type');
};
export const publicAttachment = ({ id, name, size, mime }) => ({ id, name, size, mime });

export class AttachmentStore {
  #queue = Promise.resolve();
  constructor(directory, { community, preferences, secret, limits = attachmentLimits(), now = () => Date.now() } = {}) {
    this.directory = resolve(directory);
    Object.assign(this, { community, preferences, secret: secret || randomUUID(), limits, now });
  }
  exclusive(action) {
    const next = this.#queue.then(action);
    this.#queue = next.catch(() => {});
    return next;
  }
  path(id, suffix = '') {
    if (!ID.test(id)) throw new HttpError(404, 'attachment_not_found');
    return join(this.directory, `${id}${suffix}`);
  }
  async metadata(id) {
    try { return JSON.parse(await readFile(this.path(id, '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, 'attachment_not_found'); throw error; }
  }
  async catalog() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await readdir(this.directory);
    const names = files.filter((file) => file.endsWith('.json') && ID.test(file.slice(0, -5)));
    const items = [];
    for (let offset = 0; offset < names.length; offset += 32) items.push(...await Promise.all(names.slice(offset, offset + 32).map((file) => this.metadata(file.slice(0, -5)))));
    return items;
  }
  async writeMetadata(item) {
    await writeFile(this.path(item.id, '.json.tmp'), JSON.stringify(item), { mode: 0o600 });
    await rename(this.path(item.id, '.json.tmp'), this.path(item.id, '.json'));
  }
  async upload(bytes, { userId, groupId, scope, name, maxToken }) {
    if (!['shared', 'personal'].includes(scope)) throw new HttpError(400, 'invalid_scope');
    if (!bytes.length || bytes.length > this.limits.fileBytes) throw new HttpError(413, 'attachment_size', `Файл: не более ${this.limits.fileBytes} байт / File size limit`);
    const type = await detectAttachmentType(bytes);
    return this.exclusive(async () => {
      const items = await this.catalog();
      if (items.filter((item) => !item.bound && item.userId === String(userId) && sameGroup(item.groupId, groupId)).length >= this.limits.count) throw new HttpError(413, 'attachment_count', `Не более ${this.limits.count} несохранённых вложений / Pending attachment limit`);
      if (items.filter((item) => sameGroup(item.groupId, groupId)).reduce((sum, item) => sum + item.size, 0) + bytes.length > this.limits.groupBytes) throw new HttpError(413, 'attachment_quota', 'Лимит файлов группы исчерпан / Group storage limit reached');
      if (items.reduce((sum, item) => sum + item.size, 0) + bytes.length > this.limits.totalBytes) throw new HttpError(413, 'attachment_total_quota', 'Хранилище вложений заполнено / Attachment storage limit reached');
      const disk = await statfs(this.directory);
      if (disk.bavail * disk.bsize - bytes.length < this.limits.reserveBytes) throw new HttpError(507, 'attachment_disk_full', 'Недостаточно места для файла / Storage is full');
      const item = { id: randomUUID(), name: cleanFilename(name), size: bytes.length, mime: type.mime, groupId: groupKey(groupId), scope, userId: String(userId), createdAt: this.now(), maxToken };
      try {
        await writeFile(this.path(item.id), bytes, { mode: 0o600, flag: 'wx' });
        await this.writeMetadata(item);
      } catch (error) {
        await unlink(this.path(item.id)).catch(() => {});
        if (error.code === 'ENOSPC') throw new HttpError(507, 'attachment_disk_full', 'Недостаточно места / Storage is full');
        throw error;
      }
      return publicAttachment(item);
    });
  }
  async discard(id, userId) {
    return this.exclusive(async () => {
      const item = await this.metadata(id);
      const records = await this.community.attachmentRecords();
      if (item.userId !== String(userId) || records.some((record) => record.attachments?.some((file) => file.id === id))) throw new HttpError(403, 'attachment_forbidden');
      await unlink(this.path(id));
      await unlink(this.path(id, '.json'));
    });
  }
  async resolveInput(ids, { userId, groupId, scope, current = [] }) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new HttpError(400, 'attachment_invalid');
    if (ids.length > this.limits.count) throw new HttpError(413, 'attachment_count', `Не более ${this.limits.count} вложений / Attachment count limit`);
    return Promise.all(ids.map(async (id) => {
      const item = await this.metadata(id);
      if (!sameGroup(item.groupId, groupId) || item.scope !== scope || (!current.some((file) => file.id === id) && (item.bound || item.userId !== String(userId)))) throw new HttpError(403, 'attachment_forbidden');
      return publicAttachment(item);
    }));
  }
  async authorize(id, userId) {
    const item = await this.metadata(id);
    const records = await this.community.attachmentRecords();
    const record = records.find((record) => record.attachments?.some((file) => file.id === id));
    const profile = await this.preferences.get(userId);
    const group = record?.groupId ?? item.groupId;
    const owner = record?.userId ?? item.userId;
    if (!sameGroup(profile.selection?.id, group) || (item.scope === 'personal' && String(owner) !== String(userId)) || (!record && (item.bound || String(item.userId) !== String(userId)))) throw new HttpError(403, 'attachment_forbidden');
    return item;
  }
  signature(id, userId, expires) { return createHmac('sha256', this.secret).update(`${id}:${userId}:${expires}`).digest('hex'); }
  async link(id, userId) {
    await this.authorize(id, userId);
    const expires = this.now() + 5 * 60_000;
    return { url: `/api/attachments/${id}?user=${userId}&expires=${expires}&signature=${this.signature(id, userId, expires)}`, expiresAt: new Date(expires).toISOString() };
  }
  async signedUser(id, url) {
    const user = url.searchParams.get('user');
    const expires = Number(url.searchParams.get('expires'));
    const actual = Buffer.from(url.searchParams.get('signature') ?? '', 'hex');
    const expected = Buffer.from(this.signature(id, user, expires), 'hex');
    if (!Number.isSafeInteger(expires) || expires <= this.now() || expires > this.now() + 5 * 60_000 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(403, 'attachment_link_expired', 'Ссылка истекла / Link expired');
    await this.authorize(id, user);
    return user;
  }
  async reconcile({ removeUser } = {}) {
    return this.exclusive(async () => {
      const records = await this.community.attachmentRecords();
      const used = new Set(records.flatMap((record) => (record.attachments ?? []).map((file) => file.id)));
      const items = await this.catalog();
      for (const item of items) {
        if (used.has(item.id)) {
          if (!item.bound) await this.writeMetadata({ ...item, bound: true });
        } else if (item.bound || item.createdAt < this.now() - 3600_000 || (removeUser && item.userId === String(removeUser) && item.scope === 'personal')) {
          await unlink(this.path(item.id)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
          await unlink(this.path(item.id, '.json'));
        }
      }
      // Interrupted uploads can leave a blob without its sidecar.
      const known = new Set(items.map((item) => item.id));
      const { stat } = await import('node:fs/promises');
      for (const file of await readdir(this.directory)) {
        const id = file.split('.')[0];
        if (!ID.test(id) || (known.has(id) && !file.endsWith('.tmp'))) continue;
        const path = join(this.directory, file);
        if ((await stat(path)).mtimeMs < this.now() - 3600_000) await unlink(path);
      }
    });
  }
}
