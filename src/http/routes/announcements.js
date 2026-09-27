import { HttpError } from './me.js';

const MAX_TEXT_LENGTH = 1_500;
const MAX_TITLE_LENGTH = 80;

const headmanChatOf = async (community, userId) => (await community.chatsWithRole(userId))
  .find((chat) => String(chat.headman?.userId) === String(userId)) ?? null;

const parseMoment = (value, field) => {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(date.getTime())) throw new HttpError(400, `invalid_${field}`, 'Некорректное время');
  return date.toISOString();
};

const serialize = (item, prefs, userId) => {
  const own = prefs.announcementReminders?.[item.id];
  return {
    id: item.id,
    title: item.title ?? null,
    text: item.text,
    eventAt: item.eventAt ?? null,
    remindAt: item.remindAt ?? null,
    myRemindAt: own === undefined ? item.remindAt ?? null : own,
    customized: own !== undefined,
    authorName: item.authorName ?? null,
    createdAt: item.createdAt,
    mine: String(item.authorId) === String(userId),
  };
};

export const getAnnouncements = async ({ user, preferences, community }) => {
  const prefs = await preferences.get(user.id);
  const headmanChat = await headmanChatOf(community, user.id);
  const groupId = headmanChat?.group.id ?? (prefs.selection?.kind === 'group' ? prefs.selection.id : null);
  if (!groupId) return { canPublish: false, items: [] };
  const items = await community.announcementsForGroup(groupId);
  return { canPublish: Boolean(headmanChat), items: items.map((item) => serialize(item, prefs, user.id)) };
};

// Объявление публикует только староста: в чат группы и каждому в личку (через бота).
export const postAnnouncement = async ({ user, preferences, community, body, publishAnnouncement }) => {
  const chat = await headmanChatOf(community, user.id);
  if (!chat) throw new HttpError(403, 'headman_only', 'Объявления публикует староста');
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!text) throw new HttpError(400, 'invalid_text', 'Напиши текст объявления');
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(400, 'text_too_long', `Объявление — до ${MAX_TEXT_LENGTH} символов`);
  if (title.length > MAX_TITLE_LENGTH) throw new HttpError(400, 'title_too_long', `Заголовок — до ${MAX_TITLE_LENGTH} символов`);
  const eventAt = parseMoment(body?.eventAt, 'event_at');
  const remindAt = parseMoment(body?.remindAt, 'remind_at');
  if (remindAt && new Date(remindAt) < new Date()) throw new HttpError(400, 'remind_in_past', 'Время напоминания уже прошло');
  const item = await community.addAnnouncement({
    groupId: chat.group.id,
    chatId: chat.chatId,
    groupTitle: chat.group.title,
    authorId: user.id,
    authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || null,
    title: title || null,
    text,
    eventAt,
    remindAt,
  });
  const delivery = publishAnnouncement ? await publishAnnouncement(item).catch(() => ({ chat: false })) : { chat: false };
  const prefs = await preferences.get(user.id);
  return { item: serialize(item, prefs, user.id), postedToChat: Boolean(delivery.chat) };
};

export const deleteAnnouncement = async ({ user, community, id }) => {
  const item = await community.getAnnouncement(id);
  if (!item) throw new HttpError(404, 'not_found', 'Объявление не найдено');
  const chat = await headmanChatOf(community, user.id);
  if (!chat || String(chat.group.id) !== String(item.groupId)) throw new HttpError(403, 'headman_only', 'Удалять объявления может староста');
  await community.removeAnnouncement(id);
  return { deleted: true };
};

// Своё время напоминания: null — не напоминать, reset — вернуть время старосты.
export const putAnnouncementReminder = async ({ user, preferences, community, id, body }) => {
  const item = await community.getAnnouncement(id);
  const prefs = await preferences.get(user.id);
  if (!item || String(item.groupId) !== String(prefs.selection?.id)) throw new HttpError(404, 'not_found', 'Объявление не найдено');
  const reminders = { ...prefs.announcementReminders };
  if (body?.reset === true) delete reminders[id];
  else reminders[id] = parseMoment(body?.remindAt, 'remind_at');
  const saved = await preferences.set(user.id, { ...prefs, announcementReminders: reminders });
  return { item: serialize(item, saved, user.id) };
};
