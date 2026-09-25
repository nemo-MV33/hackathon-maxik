import { addDays, parseDateKey, toDateKey } from '../../lib/date.js';
import { HttpError } from './me.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LENGTH = 2_000;

const profileGroup = async (user, preferences) => {
  const profile = await preferences.get(user.id);
  if (profile.selection?.kind !== 'group') {
    throw new HttpError(409, 'group_not_selected', 'Сначала выбери учебную группу');
  }
  return { profile, group: profile.selection };
};

const dateFrom = (value, fallback) => {
  if (!value) return fallback;
  if (!DATE_PATTERN.test(value)) throw new HttpError(400, 'invalid_date', 'Дата должна быть в формате YYYY-MM-DD');
  const parsed = parseDateKey(value);
  if (!parsed || Number.isNaN(parsed.getTime())) throw new HttpError(400, 'invalid_date', 'Некорректная дата');
  return parsed;
};

const lessonInput = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Ожидался JSON-объект');
  }
  if (!DATE_PATTERN.test(body.date ?? '')) throw new HttpError(400, 'invalid_date', 'Некорректная дата пары');
  if (!Number.isInteger(body.lessonNumber) || body.lessonNumber < 1) {
    throw new HttpError(400, 'invalid_lesson', 'Некорректный номер пары');
  }
  if (![null, 1, 2].includes(body.subgroup ?? null)) {
    throw new HttpError(400, 'invalid_subgroup', 'Подгруппа должна быть 1, 2 или null');
  }
  if (!['shared', 'personal'].includes(body.scope)) throw new HttpError(400, 'invalid_scope', 'Неизвестный тип ДЗ');
  if (body.text !== null && (typeof body.text !== 'string' || !body.text.trim())) {
    throw new HttpError(400, 'invalid_text', 'ДЗ не может быть пустым');
  }
  if (body.text?.trim().length > MAX_TEXT_LENGTH) {
    throw new HttpError(400, 'text_too_long', `В ДЗ можно сохранить до ${MAX_TEXT_LENGTH} символов`);
  }
  return {
    lessonDate: body.date,
    lessonNumber: body.lessonNumber,
    subgroup: body.subgroup ?? null,
    text: body.text?.trim() ?? null,
    scope: body.scope,
  };
};

const findLesson = async (service, groupId, input) => {
  const schedule = await service.groupSchedule(groupId, {
    week: parseDateKey(input.lessonDate),
    subgroup: input.subgroup,
  });
  const lesson = schedule.lessons.find((candidate) =>
    candidate.date === input.lessonDate
    && candidate.lessonNumber === input.lessonNumber
    && (candidate.subgroup ?? null) === input.subgroup);
  if (!lesson) throw new HttpError(404, 'lesson_not_found', 'Пара не найдена в расписании ИРНИТУ');
  return lesson;
};

const serialize = (item) => ({
  groupId: Number(item.groupId),
  date: item.lessonDate,
  lessonNumber: item.lessonNumber,
  subgroup: item.subgroup ?? null,
  subject: item.subject,
  lessonTime: item.lessonTime,
  sharedText: item.sharedText,
  personalText: item.personalText,
  text: item.text,
  source: item.source,
  updatedAt: item.updatedAt,
  authorName: item.authorName ?? null,
  version: item.version ?? 1,
});

export const getHomework = async ({ user, preferences, community, url }) => {
  const { profile, group } = await profileGroup(user, preferences);
  const requestedGroupId = Number(url.searchParams.get('groupId'));
  if (!Number.isInteger(requestedGroupId) || requestedGroupId < 1) {
    throw new HttpError(400, 'invalid_group', 'Некорректная учебная группа');
  }
  if (requestedGroupId !== Number(group.id)) {
    throw new HttpError(409, 'profile_out_of_sync', 'Группа в профиле ещё не синхронизирована');
  }
  const from = dateFrom(url.searchParams.get('from'), new Date());
  const to = dateFrom(url.searchParams.get('to'), addDays(from, 14));
  if (to < from || (to.getTime() - from.getTime()) / 86_400_000 > 62) {
    throw new HttpError(400, 'invalid_period', 'Период должен быть от 1 до 62 дней');
  }
  const [items, role] = await Promise.all([
    community.homeworkForUser(group.id, user.id, { from, to, subgroup: profile.subgroup }),
    community.homeworkRoleForGroup(group.id, user.id),
  ]);
  return {
    group,
    role,
    canEditShared: role !== 'student',
    period: { from: toDateKey(from), to: toDateKey(to) },
    items: items.map(serialize),
  };
};

export const putHomework = async ({ user, preferences, community, service, body }) => {
  const { group } = await profileGroup(user, preferences);
  const input = lessonInput(body);
  const lesson = await findLesson(service, group.id, input);
  const target = {
    groupId: group.id,
    groupTitle: group.title,
    lessonDate: lesson.date,
    lessonNumber: lesson.lessonNumber,
    lessonTime: lesson.time,
    subgroup: lesson.subgroup ?? null,
    subject: lesson.subject,
  };

  if (input.scope === 'shared') {
    const role = await community.homeworkRoleForGroup(group.id, user.id);
    if (role === 'student') throw new HttpError(403, 'homework_forbidden', 'Нет прав на изменение общего ДЗ');
    if (input.text === null) {
      await community.removeHomework(target);
      return { deleted: true, scope: input.scope };
    }
    const item = await community.upsertHomework({
      ...target,
      text: input.text,
      authorId: user.id,
      authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `MAX ID ${user.id}`,
    });
    return { item: serialize({ ...item, sharedText: item.text, personalText: null, source: 'shared' }) };
  }

  if (input.text === null) {
    await community.removePersonalHomework(user.id, target);
    return { deleted: true, scope: input.scope };
  }
  const item = await community.setPersonalHomework(user.id, { ...target, text: input.text });
  return { item: serialize({ ...item, sharedText: null, personalText: item.text, source: 'personal' }) };
};
