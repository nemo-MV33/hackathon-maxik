import { HttpError } from '../http/routes/me.js';

export const attachmentSummary = (items = []) => items.map((file) => `${file.name} (${(file.size / 1024).toFixed(1)} KB)`).join('\n');
export const incomingHomeworkAttachments = (message) => (message?.body?.attachments ?? []).filter((item) => ['image', 'file', 'video', 'audio'].includes(item.type));

const maxUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['max.ru', 'okcdn.ru', 'mycdn.me', 'userapi.com'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new HttpError(400, 'attachment_url', 'Недопустимый адрес файла / Invalid file URL');
  return url;
};
export const downloadMaxAttachment = async (item, limit, fetcher = fetch) => {
  let url = maxUrl(item.payload?.url);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = maxUrl(new URL(response.headers.get('location'), url));
      continue;
    }
    if (!response.ok) throw new HttpError(502, 'attachment_download', 'Не удалось загрузить вложение / Attachment download failed');
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new HttpError(413, 'attachment_size', 'Файл слишком большой / File too large'); }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, 'attachment_size', 'Файл слишком большой / File too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new HttpError(502, 'attachment_download');
};

// Медиа приходят одним обновлением или несколькими. Сохраняем один раз, после паузы.
export class HomeworkAttachmentBatch {
  constructor({ windowMs = 10_000, save, failed }) { Object.assign(this, { windowMs, save, failed }); this.batches = new Map(); }
  cancel(key) { const batch = this.batches.get(key); if (batch) clearTimeout(batch.timer); this.batches.delete(key); }
  async add(key, { mid, text, attachments, context }) {
    let batch = this.batches.get(key);
    if (!batch) { batch = { mids: new Set(), texts: [], attachments: [], context }; this.batches.set(key, batch); }
    if (mid && batch.mids.has(mid)) return;
    if (mid) batch.mids.add(mid);
    clearTimeout(batch.timer);
    if (text) batch.texts.push(text);
    batch.attachments.push(...attachments);
    batch.timer = setTimeout(() => this.flush(key).catch((error) => this.failed(batch.context, error)), this.windowMs);
    batch.timer.unref?.();
  }
  async flush(key) {
    const batch = this.batches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.batches.delete(key);
    return this.save(batch.context, batch.texts.join('\n'), batch.attachments, [...batch.mids]);
  }
}
