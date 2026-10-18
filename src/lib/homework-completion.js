import { createHash } from 'node:crypto';

// Отметка относится к содержимому личного задания, а не к дате пары.
// Перенос сохраняет её; новая редакция текста или файлов требует повторной проверки.
export const completionRevision = (item) => createHash('sha256').update(JSON.stringify({
  text: item.text, attachments: (item.attachments ?? []).map((file) => file.id),
  deadline: item.deadline ?? { kind: 'lesson' }, submission: item.submission ?? null,
})).digest('hex');

export const homeworkCompleted = (item, profile) => Boolean(item?.id
  && profile.homeworkCompleted?.[item.id]?.revision === completionRevision(item));
