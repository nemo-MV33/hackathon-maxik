import type { HomeworkEvent, HomeworkSnapshot } from '../data/homework';
import { saveHomework } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { formatStamp, formatMoment } from '../lib/date';
import type { Lesson } from '../data/schedule';
import { useState } from 'react';
import { HistoryIcon } from './Icon';

// История версий ДЗ: кто и когда менял текст, срок, способ сдачи и файлы.
// Староста и редакторы могут вернуть прежнюю версию общего ДЗ.
export const HomeworkHistory = ({ history, lesson, canRestore = false, currentVersion, onSaved }: {
  history: HomeworkEvent[]; lesson: Lesson; canRestore?: boolean; currentVersion?: number; onSaved: () => Promise<void>;
}) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (!history.length) return null;
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
  const author = (event: HomeworkEvent) => event.authorName ?? (event.by === 'schedule' ? t.historySchedule : event.by === 'headman' ? t.historyHeadman : '—');
  const visible = history.filter((event) => event.type !== 'attachments' || !history.some((other) => other.after && other.at === event.at));
  return <details className="history">
    <summary><HistoryIcon size={16} />{t.homeworkHistory}<span className="history__count">{visible.length}</span></summary>
    <ol className="history__list">{[...visible].reverse().map((event, index) => {
      const added = event.added ?? event.after?.attachments?.filter((file) => !event.before?.attachments?.some((old) => old.id === file.id)) ?? [];
      const removed = event.removed ?? event.before?.attachments?.filter((file) => !event.after?.attachments?.some((next) => next.id === file.id)) ?? [];
      return <li key={`${event.at}:${index}`} className="history__item">
        <p className="history__head">{event.version ? <span className="badge">v{event.version}</span> : null}<span>{author(event)}</span><span>{formatStamp(event.at)}</span></p>
        {event.restoredFrom && <p>{t.versionRestored} {event.restoredFrom}</p>}
        {(event.type === 'moved' || event.type === 'orphaned') && <p>{t.historyMoved}: {event.from?.date} {event.from?.time} → {event.to?.date ?? t.moveCancelled}</p>}
        {event.after && event.before?.text !== event.after.text && <dl className="history__diff">
          <dt>{t.historyBefore}</dt><dd>{(event.before?.text || '—').slice(0, 180)}</dd>
          <dt>{t.historyAfter}</dt><dd>{event.after.text.slice(0, 180)}</dd>
        </dl>}
        {event.after && (['deadline', 'submission'] as const).filter((field) => describe(event.before, field) !== describe(event.after, field)).map((field) => (
          <p key={field}>{field === 'deadline' ? t.deadlineLabel : t.submissionLabel}: {describe(event.before, field)} → {describe(event.after, field)}</p>
        ))}
        {added.map((file) => <p key={`+${file.id}`}>+ {file.name}</p>)}
        {removed.map((file) => <p key={`-${file.id}`} className="history__removed">− {file.name}</p>)}
        {canRestore && event.after && event.version! < (currentVersion ?? 1) && <button type="button" className="text-button" disabled={busy} onClick={() => void restore(event.version!)}>{t.restoreVersion} {event.version}</button>}
      </li>;
    })}</ol>
    {error && <p role="alert" className="callout callout--error">{error}</p>}
  </details>;
};
