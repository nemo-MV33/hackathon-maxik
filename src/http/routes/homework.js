import { detailsInput, withDeadline, dueReminderAt } from '../../lib/homework-details.js';
import { sameGroup, groupKey } from '../../universities/identity.js';
import { zonedMoment, zonedDateKey, profileTimeZone } from '../../lib/timezone.js';
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

// undefined — напоминание не трогаем, null — снять, строка ISO — поставить.
const reminderInput = (body) => {
  if (!('remindAt' in body)) return undefined;
  if (body.remindAt === null) return null;
  const date = new Date(body.remindAt);
  if (typeof body.remindAt !== 'string' || Number.isNaN(date.getTime())) throw new HttpError(400, 'invalid_remind_at', 'Некорректное время напоминания');
  return date.toISOString();
};

const reminderKey = (item) => `${item.lessonDate ?? item.date}:${item.lessonNumber}:${item.subgroup ?? 0}`;

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
  if (body.reminderMode !== undefined && !['fixed', 'lesson', 'due-day', 'due-morning'].includes(body.reminderMode)) throw new HttpError(400, 'invalid_remind_at', 'Неизвестный тип напоминания');
  if (body.minutesBefore !== undefined && (!Number.isFinite(body.minutesBefore) || body.minutesBefore < 0)) throw new HttpError(400, 'invalid_remind_at', 'Некорректный интервал напоминания');
  if (!['shared', 'personal', 'reminder'].includes(body.scope)) throw new HttpError(400, 'invalid_scope', 'Неизвестный тип ДЗ');
  if (body.restoreVersion !== undefined && (body.scope !== 'shared' || !Number.isInteger(body.restoreVersion) || body.restoreVersion < 1)) throw new HttpError(400, 'invalid_version');
  if (body.text != null && typeof body.text !== 'string') throw new HttpError(400, 'invalid_text');
  // scope: 'reminder' — только личное напоминание к паре, текст ДЗ не трогаем.
  if (body.scope === 'reminder') {
    if (!('remindAt' in body)) throw new HttpError(400, 'invalid_remind_at', 'Нужно время напоминания или null');
  } else if (body.restoreVersion === undefined && body.text !== null && (typeof body.text !== 'string' || (!body.text.trim() && !body.attachmentIds?.length))) {
    throw new HttpError(400, 'invalid_text', 'ДЗ не может быть пустым');
  }
  if (body.text?.trim().length > MAX_TEXT_LENGTH) {
    throw new HttpError(400, 'text_too_long', `В ДЗ можно сохранить до ${MAX_TEXT_LENGTH} символов`);
  }
  return {
    lessonDate: body.date,
    lessonNumber: body.lessonNumber,
    subgroup: body.subgroup ?? null,
    text: body.scope === 'reminder' || body.restoreVersion !== undefined ? null : body.text?.trim() ?? null,
    scope: body.scope,
    remindAt: reminderInput(body),
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
  if (!lesson) throw new HttpError(404, 'lesson_not_found', 'Пара не найдена в расписании');
  return lesson;
};

const serialize = (item, reminders = {}, profile = {}) => ({
  deadline: item.deadline ?? { kind: 'lesson' },
  submission: item.submission ?? null,
  dueAt: item.dueAt ?? null,
  sharedDueAt: item.sharedDueAt ?? null,
  personalDueAt: item.personalDueAt ?? null,
  sharedDeadline: item.sharedDeadline ?? item.deadline ?? { kind: 'lesson' },
  personalDeadline: item.personalDeadline ?? { kind: 'lesson' },
  sharedSubmission: item.sharedSubmission ?? item.submission ?? null,
  personalSubmission: item.personalSubmission ?? null,
  sharedHistory: item.sharedHistory ?? (item.source === 'personal' ? [] : item.history ?? []),
  personalHistory: item.personalHistory ?? (item.source === 'personal' ? item.history ?? [] : []),
  attachments: item.attachments ?? [],
  sharedAttachments: item.sharedAttachments ?? (item.source === 'personal' ? [] : item.attachments ?? []),
  personalAttachments: item.personalAttachments ?? (item.source === 'personal' ? item.attachments ?? [] : []),
  groupId: groupKey(item.groupId),
  date: item.lessonDate,
  lessonNumber: item.lessonNumber,
  subgroup: item.subgroup ?? null,
  subject: item.subject,
  lessonTime: item.lessonTime,
  sharedAuthorName: item.sharedAuthorName ?? item.authorName ?? null,
  sharedUpdatedAt: item.sharedUpdatedAt ?? item.updatedAt,
  sharedVersion: item.sharedVersion ?? item.version ?? 1,
  sharedText: item.sharedText,
  personalText: item.personalText,
  text: item.text,
  source: item.source,
  updatedAt: item.updatedAt,
  authorName: item.authorName ?? null,
  version: item.version ?? 1,
  status: item.status ?? 'active',
  history: item.history ?? [],
  reminderMode: reminders[reminderKey(item)]?.mode ?? null,
  remindAt: reminders[reminderKey(item)]?.suspended ? null : reminders[reminderKey(item)]?.mode?.startsWith('due-') ? dueReminderAt(item.dueAt, reminders[reminderKey(item)].mode, profile) : reminders[reminderKey(item)]?.at ?? null,
});

export const getHomework = async ({ user, preferences, community, service, url }) => {
  const { profile, group } = await profileGroup(user, preferences);
  let requestedGroupId;
  try { requestedGroupId = groupKey(url.searchParams.get('groupId')); }
  catch { throw new HttpError(400, 'invalid_group', 'Некорректная учебная группа'); }
  if (!sameGroup(requestedGroupId, group.id)) throw new HttpError(409, 'profile_out_of_sync', 'Группа в профиле ещё не синхронизирована');
  const from = dateFrom(url.searchParams.get('from'), new Date());
  const to = dateFrom(url.searchParams.get('to'), addDays(from, 14));
  if (to < from || (to.getTime() - from.getTime()) / 86_400_000 > 62) {
    throw new HttpError(400, 'invalid_period', 'Период должен быть от 1 до 62 дней');
  }
  const [items, role] = await Promise.all([
    community.homeworkForUser(group.id, user.id, { from: '1900-01-01', subgroup: profile.subgroup }),
    community.homeworkRoleForGroup(group.id, user.id),
  ]);
  return {
    group,
    role,
    canEditShared: role !== 'student',
    period: { from: toDateKey(from), to: toDateKey(to) },
    items: (await Promise.all(items.map((item) => withDeadline(item, service)))).filter((item) => {
      const due = item.dueAt ? zonedDateKey(new Date(item.dueAt), profileTimeZone(profile)) : null;
      return (item.lessonDate >= toDateKey(from) && item.lessonDate <= toDateKey(to)) || (due && due >= toDateKey(from) && due <= toDateKey(to))
        || (url.searchParams.get('includeOverdue') === 'true' && item.dueAt && Date.parse(item.dueAt) < Date.now());
    }).sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')).map((item) => serialize(item, profile.homeworkReminders, profile)),
  };
};

const saveReminder = async (preferences, userId, lesson, remindAt, body = {}, homework) => {
  const profile = await preferences.get(userId);
  const reminders = { ...profile.homeworkReminders };
  if (remindAt === undefined) return reminders;
  const key = reminderKey({ lessonDate: lesson.date, lessonNumber: lesson.lessonNumber, subgroup: lesson.subgroup });
  if (remindAt && body.reminderMode?.startsWith('due-')) {
    remindAt = dueReminderAt(homework?.dueAt, body.reminderMode, profile);
    if (!remindAt) throw new HttpError(409, homework?.dueAt ? 'morning_after_deadline' : 'deadline_unresolved');
    if (Date.parse(remindAt) <= Date.now()) throw new HttpError(400, 'reminder_in_past');
  }
  if (remindAt && body.reminderMode === 'lesson') remindAt = new Date(zonedMoment(lesson.date, lesson.time.slice(0, 5), lesson.timeZone).getTime() - (body.minutesBefore ?? 0) * 60_000).toISOString();
  if (remindAt) reminders[key] = { at: remindAt, subject: lesson.subject, time: lesson.time.slice(0, 5), mode: body.reminderMode ?? 'fixed', minutesBefore: Number.isFinite(body.minutesBefore) ? body.minutesBefore : 0 };
  else delete reminders[key];
  await preferences.set(userId, { ...profile, homeworkReminders: reminders });
  return reminders;
};

export const putHomework = async ({ user, preferences, community, service, body, onHomeworkSaved }) => {
  const { group, profile } = await profileGroup(user, preferences);
  const input = lessonInput(body);
  if (body.groupId != null && !sameGroup(body.groupId, group.id)) throw new HttpError(409, 'profile_out_of_sync');
  if (input.scope === 'shared' && await community.homeworkRoleForGroup(group.id, user.id) === 'student') {
    throw new HttpError(403, 'homework_forbidden', 'Нет прав на изменение общего ДЗ');
  }
  const lesson = await findLesson(service, group.id, input);
  const details = detailsInput(body, group.id);
  const effective = (await community.homeworkForUser(group.id, user.id, { from: lesson.date, to: lesson.date })).find((item) => reminderKey(item) === reminderKey(lesson));
  const deadlineItem = await withDeadline({ ...effective, groupId: group.id, lessonDate: lesson.date, lessonTime: lesson.time, subject: lesson.subject, subgroup: lesson.subgroup, ...details }, service);
  const reminders = await saveReminder(preferences, user.id, lesson, input.remindAt, body, deadlineItem);
  if (input.scope === 'reminder') {
    return { scope: 'reminder', remindAt: reminders[`${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`]?.at ?? null };
  }
  const target = {
    groupId: group.id,
    groupTitle: group.title,
    lessonDate: lesson.date,
    lessonNumber: lesson.lessonNumber,
    lessonTime: lesson.time,
    subgroup: lesson.subgroup ?? null,
    subject: lesson.subject,
  };

  const records = await community.attachmentRecords();
  const current = records.find((item) => sameGroup(item.groupId, group.id) && item.lessonDate === lesson.date
    && item.lessonNumber === lesson.lessonNumber && (item.subgroup ?? null) === (lesson.subgroup ?? null)
    && (input.scope === 'shared' ? item.userId == null : String(item.userId) === String(user.id)));
  const attachments = body.attachmentIds === undefined ? current?.attachments ?? []
    : await community.attachmentStore?.resolveInput(body.attachmentIds, { userId: user.id, groupId: group.id, scope: input.scope, current: current?.attachments ?? [] });
  if (body.attachmentIds?.length && !attachments) throw new HttpError(503, 'attachments_unavailable');

  if (body.restoreVersion !== undefined) {
    if (input.scope !== 'shared' || !Number.isInteger(body.restoreVersion)) throw new HttpError(400, 'invalid_version');
    const item = await community.restoreHomework(group.id, user.id, target, body.restoreVersion, [user.first_name, user.last_name].filter(Boolean).join(' '));
    onHomeworkSaved?.(item);
    return { item: serialize(await withDeadline({ ...item, sharedText: item.text, personalText: null, source: 'shared' }, service), reminders, profile) };
  }
  if (input.scope === 'shared') {
    const role = await community.homeworkRoleForGroup(group.id, user.id);
    if (role === 'student') throw new HttpError(403, 'homework_forbidden', 'Нет прав на изменение общего ДЗ');
    if (input.text === null) {
      await community.removeHomework(target);
      return { deleted: true, scope: input.scope };
    }
    const item = await community.upsertHomework({
      ...target,
      ...details,
      text: input.text,
      attachments,
      authorId: user.id,
      authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `MAX ID ${user.id}`,
    });
    onHomeworkSaved?.(item);
    return { item: serialize(await withDeadline({ ...item, sharedText: item.text, personalText: null, source: 'shared' }, service), reminders, profile) };
  }

  if (input.text === null) {
    await community.removePersonalHomework(user.id, target);
    return { deleted: true, scope: input.scope };
  }
  const item = await community.setPersonalHomework(user.id, { ...target, ...details, text: input.text, attachments, authorId: user.id, authorName: [user.first_name, user.last_name].filter(Boolean).join(' ') });
  return { item: serialize(await withDeadline({ ...item, sharedText: null, personalText: item.text, source: 'personal' }, service), reminders, profile) };
};
