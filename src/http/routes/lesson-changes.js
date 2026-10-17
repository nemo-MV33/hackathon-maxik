import { HttpError } from './me.js';

export const lessonChangesRoute = async ({ user, preferences, community, lessonChanges, method, id, body }) => {
  const profile = await preferences.get(user.id);
  const groupId = profile.selection?.kind === 'group' ? profile.selection.id : null;
  if (!groupId) throw new HttpError(409, 'group_not_selected', 'Сначала выбери учебную группу');
  if (method === 'GET') return { items: await community.lessonChanges(groupId) };
  if (method === 'DELETE' && id) return { item: await lessonChanges.undo(groupId, user, id) };
  if (method === 'POST' && !id) {
    if (!body || !('to' in body)) throw new HttpError(400, 'invalid_body', 'Нужны from и to');
    return { item: await lessonChanges.manual({ groupId, user, from: body.from, to: body.to }) };
  }
  throw new HttpError(405, 'method_not_allowed');
};

export const orphanedRoute = async ({ user, preferences, community, lessonChanges, method, body }) => {
  const profile = await preferences.get(user.id);
  const groupId = profile.selection?.kind === 'group' ? profile.selection.id : null;
  if (!groupId) throw new HttpError(409, 'group_not_selected');
  await lessonChanges.authorize(groupId, user.id);
  const items = await community.orphanedHomework(groupId);
  if (method === 'GET') return { items: items.map((item) => ({ ...item, date: item.lessonDate })) };
  const item = items.find((value) => value.id === body?.id);
  if (!item) throw new HttpError(404, 'homework_not_found');
  const from = { date: item.lessonDate, lessonNumber: item.lessonNumber, time: item.lessonTime, subgroup: item.subgroup ?? null };
  if (method === 'DELETE') {
    await community.removeHomework(item);
    return { deleted: true };
  }
  if (method === 'PUT') {
    const target = await lessonChanges.find(groupId, body.to);
    if ((target.subgroup ?? null) !== from.subgroup) throw new HttpError(400, 'invalid_subgroup');
    await lessonChanges.apply(groupId, from, target, `${item.id}:rebind:${target.date}:${target.lessonNumber}`, 'headman');
    return { saved: true };
  }
  throw new HttpError(405, 'method_not_allowed');
};
