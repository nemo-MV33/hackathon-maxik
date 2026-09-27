import { HttpError } from './me.js';

const KINDS = ['late', 'absent'];
const REASONS = { late: ['late10', 'late20', 'transport'], absent: ['ill', 'family', 'certificate'] };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LENGTH = 500;

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
    text: reasonCode ? null : text,
    lesson,
  });
  if (result.status === 'no_headman') {
    throw new HttpError(409, 'no_headman', 'У группы пока нет старосты в боте');
  }
  if (result.status === 'no_group') throw new HttpError(409, 'group_not_selected', 'Сначала выбери учебную группу');
  return { status: result.status };
};
