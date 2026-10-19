import { DateField } from './DateField';
import { useState } from 'react';
import type { Deadline, Submission } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { formatMoment } from '../lib/date';
import { openExternal } from '../bridge/max';

type Details = { deadline?: Deadline; submission?: Submission | null; dueAt?: string | null; completed?: boolean };
export const HomeworkDetails = ({ deadline, submission, dueAt, completed }: Details) => {
  const { t } = useI18n();
  return <div className="hw-details">
    <p className="hw-details__deadline">{t.deadlineLabel}: {dueAt ? `${formatMoment(dueAt)}` : t.deadlineKinds[deadline?.kind ?? 'lesson']}</p>
    {!completed && dueAt && Date.parse(dueAt) < Date.now() && <p className="callout" role="status">{t.overdue}</p>}
    {submission && <p>{t.submissionLabel}: {t.submissionKinds[submission.kind]}{submission.label ? ` · ${submission.label}` : ''}
      {submission.url && <><br /><a href={submission.url} target="_blank" rel="noreferrer" onClick={(event) => { if (openExternal(submission.url!)) event.preventDefault(); }}>{t.openSubmission}</a></>}
    </p>}
  </div>;
};
export const HomeworkDetailsEditor = ({ deadline, submission, onDeadline, onSubmission, standalone = false }: Details & {
  standalone?: boolean;
  onDeadline: (value: Deadline) => void; onSubmission: (value: Submission | null) => void;
}) => {
  const { t } = useI18n();
  const kind = deadline?.kind ?? 'lesson';
  const [linkTouched, setLinkTouched] = useState(false);
  const invalidLink = submission?.url && (() => { try { const url = new URL(submission.url!); return url.protocol !== 'https:' || !!url.username || !!url.password; } catch { return true; } })();
  return <details className="hw-details-editor" open><summary>{t.homeworkOptions}</summary><div className="hw-details-editor__fields">
    {!standalone && <label className="field-label">{t.deadlineLabel}
      <select className="field" value={kind} onChange={(event) => onDeadline({ kind: event.target.value as Deadline['kind'] })}>
        {Object.entries(t.deadlineKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>}
    {kind === 'date' && <DateField type="datetime-local" label={t.deadlineUniversityTime} required value={deadline?.local ?? ''} onChange={(local) => onDeadline({ kind: 'date', local })} />}
    <label className="field-label">{t.submissionLabel}
      <select className="field" value={submission?.kind ?? ''} onChange={(event) => {
        const next = event.target.value as Submission['kind'];
        onSubmission(next ? { kind: next, label: next === 'class' || next === 'moodle' ? '' : submission?.label ?? '', url: next === 'class' || next === 'email' ? null : submission?.url ?? null } : null);
      }}>
        <option value="">{t.optionalField}</option>
        {Object.entries(t.submissionKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {submission && submission.kind !== 'class' && <>
      {submission.kind !== 'moodle' && <label className="field-label">{t.submissionNote}<input className="field" value={submission.label ?? ''} maxLength={200} onChange={(event) => onSubmission({ ...submission, label: event.target.value })} /></label>}
      {submission.kind !== 'email' && <label className="field-label">{t.submissionLink}<input className="field" type="url" inputMode="url" placeholder="https://…" value={submission.url ?? ''} aria-invalid={linkTouched && !!invalidLink} onBlur={() => { setLinkTouched(true); const value = submission.url?.trim(); if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) onSubmission({ ...submission, url: `https://${value}` }); }} onChange={(event) => onSubmission({ ...submission, url: event.target.value || null })} /></label>}
      {linkTouched && invalidLink && <p className="callout callout--error" role="alert">{t.httpsOnly}</p>}
    </>}
  </div></details>;
};
