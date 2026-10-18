import type { HomeworkEvent, HomeworkItem, HomeworkSnapshot } from '../data/homework';
import { saveHomework } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { formatStamp, formatMoment } from '../lib/date';
import type { Lesson } from '../data/schedule';
import { useState } from 'react';

export const HomeworkHistory = ({ history, lesson, canRestore = false, currentVersion, onSaved }: {
  history: HomeworkEvent[]; lesson: Lesson; canRestore?: boolean; currentVersion?: number; onSaved: () => Promise<void>;
}) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const describe = (snapshot: HomeworkSnapshot | null | undefined, field: 'deadline' | 'submission') => {
    if (field === 'deadline') return snapshot?.deadline?.kind === 'date' ? snapshot.deadline.at ? formatMoment(snapshot.deadline.at) : snapshot.deadline.local ?? t.optionalField : t.deadlineKinds[snapshot?.deadline?.kind ?? 'lesson'];
    return snapshot?.submission ? [t.submissionKinds[snapshot.submission.kind], snapshot.submission.label, snapshot.submission.url].filter(Boolean).join(' · ') : t.optionalField;
  };
  const restore = async (version: number) => {
    setBusy(true); setError('');
    try { await saveHomework(lesson, '', 'shared', undefined, undefined, undefined, undefined, { restoreVersion: version }); await onSaved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const visible = history.filter((event) => event.type !== 'attachments' || !history.some((other) => other.after && other.at === event.at));
  return <details className="hw-history"><summary>{t.homeworkHistory}</summary>
    {history.length === 0 && <p>{t.homeworkHistoryEmpty}</p>}
    <ol>{[...visible].reverse().map((event, index) => <li key={`${event.at}:${index}`}>
      <p className="hw-block__meta">{event.version ? `v${event.version} · ` : ''}{event.authorName ?? (event.by === 'schedule' ? t.historySchedule : event.by === 'headman' ? t.historyHeadman : event.by ?? '—')} · {formatStamp(event.at)}</p>
      {event.restoredFrom && <p>{t.versionRestored} {event.restoredFrom}</p>}
      {(event.type === 'moved' || event.type === 'orphaned') && <p>{t.historyMoved}: {event.from?.date} {event.from?.time} / {event.to?.date ?? t.moveCancelled}{event.by === 'headman' ? ` · ${t.historyHeadman}` : ''}</p>}
      {event.after && <>
        {event.before?.text !== event.after.text && <p>{t.historyBefore}: {(event.before?.text ?? '—').slice(0, 180)}<br />{t.historyAfter}: {event.after.text.slice(0, 180)}</p>}
        {(['deadline', 'submission'] as const).map((field) => describe(event.before, field) !== describe(event.after, field) && <p key={field}>{field === 'deadline' ? t.deadlineLabel : t.submissionLabel}<br />{t.historyBefore}: {describe(event.before, field)}<br />{t.historyAfter}: {describe(event.after, field)}</p>)}
      </>}
      {(event.added ?? event.after?.attachments?.filter((file) => !event.before?.attachments?.some((old) => old.id === file.id)) ?? []).map((file) => <p key={`+${file.id}`}>{t.historyAdded}: {file.name}</p>)}
      {(event.removed ?? event.before?.attachments?.filter((file) => !event.after?.attachments?.some((next) => next.id === file.id)) ?? []).map((file) => <p key={`-${file.id}`}>{t.historyRemoved}: {file.name}</p>)}
      {canRestore && event.after && event.version! < (currentVersion ?? 1) && <button type="button" className="pill-button" disabled={busy} onClick={() => void restore(event.version!)}>{t.restoreVersion} {event.version}</button>}
    </li>)}</ol>
    {error && <p role="alert" className="callout callout--error">{error}</p>}
  </details>;
};
