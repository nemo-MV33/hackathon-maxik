// «~» не пересекается с разделителями старых callback payload и ключей уроков.
export const groupKey = (value, universityId = 'irnitu') => {
  const text = String(value ?? '');
  if (/^(irnitu|bgu)~[1-9]\d*$/.test(text)) return text;
  if (/^[1-9]\d*$/.test(text)) return `${universityId}~${text}`;
  throw new Error('invalid_group_id');
};
export const splitGroupKey = (value) => {
  const [universityId, sourceId] = groupKey(value).split('~');
  return { universityId, sourceId: Number(sourceId) };
};
export const sameGroup = (left, right) => left != null && right != null && groupKey(left) === groupKey(right);

// Идемпотентная миграция известных ссылок. Идентификаторы пользователей и UUID не меняются.
export const migrateGroupReferences = (value) => {
  if (Array.isArray(value)) return value.map(migrateGroupReferences);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateGroupReferences(item)]));
  if (result.groupId != null) result.groupId = groupKey(result.groupId);
  if (Array.isArray(result.groupIds)) result.groupIds = result.groupIds.map((id) => groupKey(id));
  for (const field of ['selection', 'group']) {
    if (result[field]?.id != null && (!result[field].kind || result[field].kind === 'group')) {
      result[field] = { ...result[field], id: groupKey(result[field].id), universityId: splitGroupKey(result[field].id).universityId };
    }
  }
  if (result.selection?.kind === 'group') {
    const id = result.selection.id;
    for (const field of ['sentReminders', 'examReminders', 'sentScheduled']) {
      if (Array.isArray(result[field])) result[field] = result[field].map((key) => String(key).includes('|') ? key : `${id}|${key}`);
    }
    if (result.homeworkReminders) result.homeworkReminders = Object.fromEntries(Object.entries(result.homeworkReminders).map(([key, reminder]) => [key, { ...reminder, groupId: id }]));
  }
  return result;
};
