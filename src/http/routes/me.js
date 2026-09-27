import {
  END_MINUTES, NOTIFICATION_KINDS, REMINDER_MINUTES, SUMMARY_TIME_PATTERN,
  endMinutes, notificationEnabled, reminderMinutes, summaryTime,
} from '../../lib/settings.js';

export class HttpError extends Error {
  constructor(status, error, message) {
    super(message ?? error);
    this.status = status;
    this.error = error;
  }
}

// Форма контроля по дисциплине — студент отмечает сам, из ИРНИТУ она не приходит.
export const CONTROL_FORMS = ['exam', 'credit', 'graded_credit', 'coursework', 'none'];
const MAX_CONTROLS = 60;

const publicProfile = (saved) => ({
  group: saved.selection?.kind === 'group'
    ? { id: saved.selection.id, title: saved.selection.title }
    : null,
  institute: saved.institute ?? null,
  course: saved.course ?? null,
  subgroup: saved.subgroup ?? null,
  remindersEnabled: saved.remindersEnabled !== false,
  muted: saved.muted === true,
  reminderMinutes: reminderMinutes(saved),
  endMinutes: endMinutes(saved),
  summaryTime: summaryTime(saved),
  lang: saved.lang ?? null,
  onboarded: Boolean(saved.onboarded),
  notifications: Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, notificationEnabled({ ...saved, muted: false }, kind)])),
  controls: saved.controls ?? {},
});

const parseSubgroup = (value) => {
  if (value === null || value === undefined) return null;
  if (value === 1 || value === 2) return value;
  throw new HttpError(400, 'invalid_subgroup', 'Подгруппа должна быть 1, 2 или null');
};

const roleOf = async (community, userId) => {
  const chats = await community.chatsWithRole(userId);
  const headman = chats.find((chat) => String(chat.headman?.userId) === String(userId));
  if (headman) return { role: 'headman', chat: headman };
  if (chats.length) return { role: 'editor', chat: chats[0] };
  return { role: 'student', chat: null };
};

export const getMe = async ({ user, preferences, community }) => {
  const saved = await preferences.get(user.id);
  const { role, chat } = community ? await roleOf(community, user.id) : { role: 'student', chat: null };
  const groupChat = saved.selection?.kind === 'group' && community
    ? (await community.chatsForGroup(saved.selection.id)).find((item) => item.headman?.userId) ?? null
    : null;
  return {
    user: {
      id: user.id,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
    },
    profile: publicProfile(saved),
    role,
    headman: groupChat?.headman ? { name: groupChat.headman.name } : null,
    deputy: role === 'headman' && chat?.deputy ? { userId: chat.deputy.userId, name: chat.deputy.name } : null,
    chatLinked: Boolean(groupChat),
  };
};

export const updateMe = async ({ user, preferences, service, body }) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Ожидался JSON-объект');
  }

  const saved = await preferences.get(user.id);
  // Имя нужно старосте: в списке одногруппников для выбора доверенного лица.
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : null);
  const patch = name && name !== saved.name ? { name } : {};

  if ('groupId' in body) {
    const groups = await service.groups();
    const group = groups.find((item) => item.id === Number(body.groupId));
    if (!group) throw new HttpError(400, 'unknown_group', 'Такой группы нет в расписании ИРНИТУ');
    patch.selection = { kind: 'group', id: group.id, title: group.title };
    patch.institute = group.institute;
    patch.course = group.course;
    patch.subgroup = null;
    // Новая группа — новый набор дисциплин: старые формы контроля и напоминания к парам не переносим.
    if (String(saved.selection?.id) !== String(group.id)) {
      patch.controls = {};
      patch.homeworkReminders = {};
      patch.announcementReminders = {};
    }
  }
  if ('subgroup' in body) patch.subgroup = parseSubgroup(body.subgroup);
  for (const key of ['remindersEnabled', 'muted', 'onboarded']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') throw new HttpError(400, `invalid_${key}`, `${key} должен быть true или false`);
    patch[key] = body[key];
  }
  if ('reminderMinutes' in body) {
    if (!REMINDER_MINUTES.includes(body.reminderMinutes)) throw new HttpError(400, 'invalid_reminder_minutes', `Можно: ${REMINDER_MINUTES.join(', ')}`);
    patch.reminderMinutes = body.reminderMinutes;
  }
  if ('endMinutes' in body) {
    if (!END_MINUTES.includes(body.endMinutes)) throw new HttpError(400, 'invalid_end_minutes', `Можно: ${END_MINUTES.join(', ')}`);
    patch.endMinutes = body.endMinutes;
  }
  if ('summaryTime' in body) {
    if (!SUMMARY_TIME_PATTERN.test(body.summaryTime ?? '')) throw new HttpError(400, 'invalid_summary_time', 'Время сводки — с 16:00 до 23:30, шаг 30 минут');
    patch.summaryTime = body.summaryTime;
    // Новое время сводки должно сработать уже сегодня.
    patch.summarySentFor = null;
  }

  if ('lang' in body) {
    if (!['ru', 'en'].includes(body.lang)) throw new HttpError(400, 'invalid_lang', 'lang должен быть ru или en');
    patch.lang = body.lang;
  }

  if ('notifications' in body) {
    const value = body.notifications;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'invalid_notifications', 'notifications должен быть объектом');
    }
    const next = { ...saved.notifications };
    for (const [kind, enabled] of Object.entries(value)) {
      if (!NOTIFICATION_KINDS.includes(kind) || typeof enabled !== 'boolean') {
        throw new HttpError(400, 'invalid_notifications', `Неизвестная настройка уведомлений: ${kind}`);
      }
      next[kind] = enabled;
    }
    patch.notifications = next;
  }

  if ('controls' in body) {
    const value = body.controls;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_controls', 'controls должен быть объектом');
    const next = { ...(patch.controls ?? saved.controls) };
    for (const [subject, form] of Object.entries(value)) {
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) throw new HttpError(400, 'invalid_controls', 'Некорректная дисциплина');
      if (form === null) delete next[subject];
      else if (CONTROL_FORMS.includes(form)) next[subject] = form;
      else throw new HttpError(400, 'invalid_controls', `Неизвестная форма контроля: ${form}`);
    }
    if (Object.keys(next).length > MAX_CONTROLS) throw new HttpError(400, 'invalid_controls', 'Слишком много дисциплин');
    patch.controls = next;
  }

  const value = await preferences.set(user.id, { ...saved, ...patch });
  return { profile: publicProfile(value) };
};

// Удаление аккаунта: всё личное стирается, журнал опозданий группы остаётся у старосты.
export const deleteMe = async ({ user, preferences, community }) => {
  await community.removeUser(user.id);
  await preferences.delete(user.id);
  return { deleted: true };
};
