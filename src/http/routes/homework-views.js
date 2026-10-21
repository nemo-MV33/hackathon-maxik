import { homeworkViewKey } from '../../storage/community.js';
import { parseDateKey } from '../../lib/date.js';
import { sameGroup } from '../../universities/identity.js';
import { HttpError, profileGroupId } from './me.js';

const viewInput = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_body', 'Ожидался JSON-объект');
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !parseDateKey(body.date)) throw new HttpError(400, 'invalid_date', 'Некорректная дата пары');
  if (!Number.isInteger(body.lessonNumber) || body.lessonNumber < 1) throw new HttpError(400, 'invalid_lesson', 'Некорректный номер пары');
  if (![null, 1, 2].includes(body.subgroup ?? null)) throw new HttpError(400, 'invalid_subgroup', 'Подгруппа должна быть 1, 2 или null');
  return { lessonDate: body.date, lessonNumber: body.lessonNumber, subgroup: body.subgroup ?? null };
};

// Участники группы в боте; ДЗ подгруппы адресовано только ей и тем, кто подгруппу не выбрал.
const groupMembers = async (preferences, groupId, subgroup) => (await preferences.entries())
  .filter(([, prefs]) => prefs.selection?.kind === 'group' && sameGroup(prefs.selection.id, groupId))
  .filter(([, prefs]) => !subgroup || !prefs.subgroup || prefs.subgroup === subgroup)
  .map(([id]) => id);

export const postHomeworkView = async ({ user, preferences, community, body }) => {
  const input = viewInput(body);
  const profile = await preferences.get(user.id);
  if (profile.selection?.kind !== 'group') throw new HttpError(409, 'group_not_selected', 'Сначала выбери учебную группу');
  const groupId = profile.selection.id;
  const key = homeworkViewKey(input);
  const shared = (await community.homeworkForGroup(groupId, { from: input.lessonDate, to: input.lessonDate }))
    .find((item) => item.lessonNumber != null && homeworkViewKey(item) === key);
  // Пустой слот не считаем: смотреть было нечего.
  if (!shared) return { recorded: false, reach: null };
  const recorded = await community.recordHomeworkView({ userId: user.id, groupId, key });
  const role = await community.homeworkRoleForGroup(groupId, user.id);
  if (!['headman', 'editor'].includes(role)) return { recorded, reach: null };
  const [viewers, members] = await Promise.all([community.homeworkViewers(groupId, key), groupMembers(preferences, groupId, input.subgroup)]);
  return { recorded, reach: { seen: members.filter((id) => viewers.has(String(id))).length, total: members.length } };
};

export const getHomeworkViewSummary = async ({ user, preferences, community }) => {
  const chat = await community.headmanChat(user.id, profileGroupId(await preferences.get(user.id)));
  if (!chat) throw new HttpError(403, 'headman_only', 'Доступно только старосте');
  return community.homeworkViewStats(chat.group.id);
};
