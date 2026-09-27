import { HttpError } from './me.js';
import { noticeMinutes } from '../../lib/settings.js';

const KINDS = ['late', 'absent'];
const REASONS = { late: ['late10', 'late20', 'transport'], absent: ['ill', 'family', 'certificate'] };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LENGTH = 500;
const LATE_MINUTES = [5, 10, 15, 20, 30, 45, 60];

const findLesson = async (service, group, subgroup, date, lessonNumber) => {
  const [year, month, day] = date.split('-').map(Number);
  const schedule = await service.groupSchedule(group.id, { week: new Date(year, month - 1, day, 12), subgroup });
  const lesson = schedule.lessons.find((item) => item.date === date && item.lessonNumber === lessonNumber);
  if (!lesson) throw new HttpError(404, 'lesson_not_found', 'Пара не найдена в расписании ИРНИТУ');
  return lesson;
};

export const postAbsence = async ({ user, preferences, service, sendAbsence, body }) => {
  if (!sendAbsence) throw new HttpError(503, 'bot_unavailable', 'Бот сейчас недоступен');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Ожидался JSON-объект');
  }
  if (!KINDS.includes(body.kind)) throw new HttpError(400, 'invalid_kind', 'kind должен быть late или absent');
  const reasonCode = body.reason ?? null;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (reasonCode !== null && !REASONS[body.kind].includes(reasonCode)) {
    throw new HttpError(400, 'invalid_reason', 'Неизвестная причина');
  }
  if (!reasonCode && !text) throw new HttpError(400, 'invalid_text', 'Укажи причину');
  if (text.length > MAX_TEXT_LENGTH) {
    throw new HttpError(400, 'text_too_long', `Причина — до ${MAX_TEXT_LENGTH} символов`);
  }

  if (body.minutes !== undefined && (body.kind !== 'late' || !LATE_MINUTES.includes(body.minutes))) {
    throw new HttpError(400, 'invalid_minutes', `На сколько опоздаешь: ${LATE_MINUTES.join(', ')} минут`);
  }

  const prefs = await preferences.get(user.id);
  const group = prefs.selection?.kind === 'group' ? prefs.selection : null;
  if (!group) throw new HttpError(409, 'group_not_selected', 'Сначала выбери учебную группу');

  let lesson;
  if (body.lessonDate !== undefined || body.lessonNumber !== undefined) {
    if (!DATE_PATTERN.test(body.lessonDate ?? '') || !Number.isInteger(body.lessonNumber)) {
      throw new HttpError(400, 'invalid_lesson', 'Некорректная пара');
    }
    lesson = await findLesson(service, group, prefs.subgroup ?? null, body.lessonDate, body.lessonNumber);
  }

  const result = await sendAbsence({
    user: { user_id: user.id, first_name: user.first_name, last_name: user.last_name, username: user.username },
    prefs,
    kind: body.kind,
    reasonCode,
    text: text || null,
    minutes: body.minutes ?? null,
    lesson,
  });
  if (result.status === 'no_headman') {
    throw new HttpError(409, 'no_headman', 'У группы пока нет старосты в боте');
  }
  if (result.status === 'no_deputy') {
    throw new HttpError(409, 'no_deputy', 'Выбери одногруппника, которому передавать твои опоздания');
  }
  if (result.status === 'no_group') throw new HttpError(409, 'group_not_selected', 'Сначала выбери учебную группу');
  return { status: result.status };
};

const serializeNotice = (item, { withName }) => ({
  id: item.id,
  kind: item.kind,
  senderId: withName ? item.senderId : undefined,
  senderName: withName ? item.senderName ?? null : null,
  reason: item.reasonCode ?? null,
  text: item.text ?? null,
  minutes: noticeMinutes(item),
  lesson: item.lesson ?? null,
  date: item.date ?? item.lesson?.date ?? item.createdAt?.slice(0, 10),
  createdAt: item.createdAt,
  acceptedAt: item.acceptedAt ?? null,
  status: item.status,
});

const headmanChatOf = async (community, userId) => (await community.chatsWithRole(userId))
  .find((chat) => String(chat.headman?.userId) === String(userId)) ?? null;

// История: студенту — только свои сообщения, старосте — ещё и «досье» по каждому студенту.
// Сообщения самого старосты (они уходят доверенному одногруппнику) в досье группы не попадают.
export const getAbsenceHistory = async ({ user, preferences, community, url }) => {
  const prefs = await preferences.get(user.id);
  const headmanChat = await headmanChatOf(community, user.id);
  const groupId = headmanChat?.group.id ?? (prefs.selection?.kind === 'group' ? prefs.selection.id : null);
  if (!groupId) return { role: 'student', mine: [], students: [] };
  const mine = (await community.noticesForGroup(groupId, { senderId: user.id }))
    .map((item) => serializeNotice(item, { withName: false }));
  if (!headmanChat) return { role: 'student', mine, students: [] };

  const all = (await community.noticesForGroup(groupId)).filter((item) => String(item.senderId) !== String(user.id));
  const student = url.searchParams.get('student');
  if (student) {
    const items = all.filter((item) => String(item.senderId) === student);
    if (!items.length) throw new HttpError(404, 'student_not_found', 'У этого студента нет сообщений');
    return {
      role: 'headman',
      student: {
        id: Number(student),
        name: items[0].senderName,
        totalMinutes: items.reduce((sum, item) => sum + noticeMinutes(item), 0),
        late: items.filter((item) => item.kind === 'late').length,
        absent: items.filter((item) => item.kind === 'absent').length,
        items: items.map((item) => serializeNotice(item, { withName: true })),
      },
    };
  }
  const bySender = new Map();
  for (const item of all) {
    const key = String(item.senderId);
    const entry = bySender.get(key) ?? { id: Number(item.senderId), name: item.senderName, totalMinutes: 0, late: 0, absent: 0, last: item.createdAt };
    entry.totalMinutes += noticeMinutes(item);
    entry[item.kind] += 1;
    bySender.set(key, entry);
  }
  return {
    role: 'headman',
    mine,
    students: [...bySender.values()].sort((left, right) => right.totalMinutes - left.totalMinutes),
  };
};

const irkutskToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Irkutsk', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// Старосте — все сообщения группы за день, студенту — только его собственные (без чужих имён).
export const getAbsences = async ({ user, preferences, community, url }) => {
  const date = url.searchParams.get('date') ?? irkutskToday();
  if (!DATE_PATTERN.test(date)) throw new HttpError(400, 'invalid_date', 'Дата должна быть в формате YYYY-MM-DD');
  const headmanChat = (await community.chatsWithRole(user.id))
    .find((chat) => String(chat.headman?.userId) === String(user.id));
  const prefs = await preferences.get(user.id);
  const groupId = headmanChat?.group.id ?? (prefs.selection?.kind === 'group' ? prefs.selection.id : null);
  if (!groupId) return { role: 'student', date, items: [] };
  const notices = await community.noticesForDay(groupId, date, headmanChat ? {} : { senderId: user.id });
  return {
    role: headmanChat ? 'headman' : 'student',
    date,
    items: notices
      .filter((item) => !headmanChat || String(item.senderId) !== String(user.id))
      .map((item) => serializeNotice(item, { withName: Boolean(headmanChat) })),
  };
};

// Староста выбирает одногруппника, которому уходят его собственные «опоздаю / не приду».
// Выбирать можно только тех, кто уже пользуется ботом в этой группе.
export const getGroupMembers = async ({ user, preferences, community }) => {
  const chat = await headmanChatOf(community, user.id);
  if (!chat) throw new HttpError(403, 'headman_only', 'Доступно только старосте');
  const members = (await preferences.entries())
    .filter(([id, prefs]) => String(id) !== String(user.id) && String(prefs.selection?.id) === String(chat.group.id))
    .map(([id, prefs]) => ({ userId: Number(id), name: prefs.name ?? null }))
    .filter((member) => member.name);
  return { deputy: chat.deputy ?? null, members };
};

export const putDeputy = async ({ user, preferences, community, body }) => {
  const chat = await headmanChatOf(community, user.id);
  if (!chat) throw new HttpError(403, 'headman_only', 'Доступно только старосте');
  if (body?.userId === null) {
    await community.setChat(chat.chatId, { deputy: null });
    return { deputy: null };
  }
  const prefs = await preferences.get(body?.userId);
  if (!Number.isInteger(body?.userId) || String(prefs.selection?.id) !== String(chat.group.id) || String(body.userId) === String(user.id)) {
    throw new HttpError(400, 'invalid_deputy', 'Можно выбрать только одногруппника, который пользуется ботом');
  }
  const deputy = { userId: body.userId, name: prefs.name ?? `MAX ID ${body.userId}` };
  await community.setChat(chat.chatId, { deputy });
  return { deputy };
};
