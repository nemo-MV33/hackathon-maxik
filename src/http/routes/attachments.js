import { readFile } from 'node:fs/promises';
import { HttpError } from './me.js';

export const uploadAttachment = async ({ request, user, preferences, community, url }) => {
  const store = community.attachmentStore;
  if (!store) throw new HttpError(503, 'attachments_unavailable');
  const profile = await preferences.get(user.id);
  if (profile.selection?.kind !== 'group') throw new HttpError(409, 'group_not_selected');
  const scope = url.searchParams.get('scope');
  if (scope === 'shared' && await community.homeworkRoleForGroup(profile.selection.id, user.id) === 'student') throw new HttpError(403, 'homework_forbidden');
  if (Number(request.headers['content-length']) > store.limits.fileBytes) throw new HttpError(413, 'attachment_size', `Файл: не более ${store.limits.fileBytes} байт / File size limit`);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > store.limits.fileBytes) throw new HttpError(413, 'attachment_size', 'Файл слишком большой / File too large');
    chunks.push(chunk);
  }
  return { item: await store.upload(Buffer.concat(chunks), { userId: user.id, groupId: profile.selection.id, scope, name: url.searchParams.get('name') }) };
};

export const sendAttachment = async ({ response, store, id, userId }) => {
  const item = await store.authorize(id, userId);
  const bytes = await readFile(store.path(id)).catch((error) => { if (error.code === 'ENOENT') throw new HttpError(404, 'attachment_not_found'); throw error; });
  response.writeHead(200, {
    'Content-Type': item.mime,
    'Content-Length': bytes.length,
    'Content-Disposition': `${item.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(item.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  response.end(bytes);
};
