import { universityTimeZone, zonedMoment, zonedDateKey, profileTimeZone } from './timezone.js';
import { addDays, parseDateKey } from './date.js';
import { HttpError } from '../http/routes/me.js';

export const detailsInput = (body, groupId) => {
  const result = {};
  if ('deadline' in body) {
    const value = body.deadline;
    if (value === null || value?.kind === 'lesson') result.deadline = { kind: 'lesson' };
    else if (value?.kind === 'next') result.deadline = { kind: 'next' };
    else if (value?.kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.local ?? '') || !parseDateKey(value.local.slice(0, 10))) throw new HttpError(400, 'invalid_deadline');
      try { result.deadline = { kind: 'date', local: value.local, timeZone: universityTimeZone(groupId), at: zonedMoment(value.local.slice(0, 10), value.local.slice(11), universityTimeZone(groupId)).toISOString() }; }
      catch { throw new HttpError(400, 'invalid_deadline'); }
    } else throw new HttpError(400, 'invalid_deadline');
  }
  if ('submission' in body) {
    const value = body.submission;
    if (value === null) result.submission = null;
    else {
      if (!value || !['class', 'moodle', 'system', 'email', 'other'].includes(value.kind)) throw new HttpError(400, 'invalid_submission');
      if (value.label != null && typeof value.label !== 'string') throw new HttpError(400, 'invalid_submission');
      if (value.url != null && (typeof value.url !== 'string' || value.url.length > 2000)) throw new HttpError(400, 'invalid_submission_url');
      const label = String(value.label ?? '').trim();
      if (label.length > 200) throw new HttpError(400, 'invalid_submission');
      let url = null;
      if (value.url) {
        try { const parsed = new URL(value.url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(); url = parsed.href; }
        catch { throw new HttpError(400, 'invalid_submission_url', 'Ссылка должна начинаться с https://'); }
      }
      result.submission = { kind: value.kind, label, url };
    }
  }
  return result;
};

export const deadlineAt = async (item, service) => {
  const deadline = item.deadline ?? { kind: 'lesson' };
  if (deadline.kind === 'date') return deadline.at;
  if (item.status === 'orphaned' || !item.lessonTime) return null;
  const start = zonedMoment(item.lessonDate, item.lessonTime.slice(0, 5), universityTimeZone(item.groupId)).toISOString();
  if (deadline.kind === 'lesson') return start;
  if (!service) return null;
  // Ищем не дальше восьми недель; неизвестная следующая пара остаётся явно неопределённой.
  for (let offset = 0; offset < 56; offset += 7) {
    const schedule = await service.groupSchedule(item.groupId, { week: addDays(parseDateKey(item.lessonDate), offset), subgroup: item.subgroup });
    const candidates = schedule.lessons.filter((lesson) => lesson.subject === item.subject
      && (!item.subgroup || !lesson.subgroup || item.subgroup === lesson.subgroup))
      .map((lesson) => lesson.startsAt ?? zonedMoment(lesson.date, lesson.time.slice(0, 5), lesson.timeZone ?? universityTimeZone(item.groupId)).toISOString())
      .filter((at) => at > start).sort();
    if (candidates.length) return candidates[0];
  }
  return null;
};

export const withDeadline = async (item, service) => ({ ...item, dueAt: await deadlineAt(item, service),
  ...(item.sharedDeadline ? { sharedDueAt: await deadlineAt({ ...item, deadline: item.sharedDeadline }, service) } : {}),
  ...(item.personalDeadline ? { personalDueAt: await deadlineAt({ ...item, deadline: item.personalDeadline }, service) } : {}),
});
export const dueReminderAt = (dueAt, mode, profile) => {
  if (!dueAt) return null;
  if (mode === 'due-day') return new Date(Date.parse(dueAt) - 86_400_000).toISOString();
  if (mode === 'due-morning') {
    const at = zonedMoment(zonedDateKey(new Date(dueAt), profileTimeZone(profile)), '08:00', profileTimeZone(profile)).toISOString();
    return at < dueAt ? at : null;
  }
  return null;
};

export const detailsText = (item, lang = 'ru', zone = universityTimeZone(item.groupId)) => {
  const en = lang === 'en';
  const kind = item.deadline?.kind ?? 'lesson';
  const at = item.dueAt ?? item.deadline?.at ?? (kind === 'lesson' && item.status !== 'orphaned' && item.lessonTime ? zonedMoment(item.lessonDate, item.lessonTime.slice(0, 5), universityTimeZone(item.groupId)).toISOString() : null);
  const when = at ? new Intl.DateTimeFormat(en ? 'en-GB' : 'ru-RU', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at)) + ` (${zone})` : (kind === 'next' ? (en ? 'next lesson date pending' : 'дата следующей пары уточняется') : (en ? 'this lesson' : 'к этой паре'));
  const methods = en ? { class: 'in class', moodle: 'Moodle', system: 'another system', email: 'email', other: 'other' } : { class: 'на паре', moodle: 'Moodle', system: 'другая система', email: 'почта', other: 'другое' };
  return `${en ? 'Due' : 'Срок'}: ${when}${item.submission ? `\n${en ? 'Submit' : 'Сдача'}: ${methods[item.submission.kind]}${item.submission.label ? ` · ${item.submission.label}` : ''}${item.submission.url ? `\n${item.submission.url}` : ''}` : ''}`;
};

export const versionSnapshot = (item) => ({
  text: item.text ?? '', attachments: item.attachments ?? [], deadline: item.deadline ?? { kind: 'lesson' }, submission: item.submission ?? null,
});
export const revisionEvent = (current, item, extra = {}) => ({
  type: extra.restoredFrom ? 'restored' : 'edited', version: item.version, at: item.updatedAt, by: item.authorId ?? item.userId,
  authorName: item.authorName ?? null, before: current ? versionSnapshot(current) : null, after: versionSnapshot(item), ...extra,
});
