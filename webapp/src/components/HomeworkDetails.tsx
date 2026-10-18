import type { Deadline, Submission } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { formatMoment } from '../lib/date';
import { userTimeZone } from '../lib/timezone';
import { openExternal } from '../bridge/max';

type Details = { deadline?: Deadline; submission?: Submission | null; dueAt?: string | null };
export const HomeworkDetails = ({ deadline, submission, dueAt }: Details) => {
  const { t } = useI18n();
  return <div className="hw-details">
    <p>{t.deadlineLabel}: {dueAt ? `${formatMoment(dueAt)} (${userTimeZone()})` : t.deadlineKinds[deadline?.kind ?? 'lesson']}</p>
    {dueAt && Date.parse(dueAt) < Date.now() && <p className="callout" role="status">{t.overdue}</p>}
    {submission && <p>{t.submissionLabel}: {t.submissionKinds[submission.kind]}{submission.label ? ` · ${submission.label}` : ''}
      {submission.url && <><br /><a href={submission.url} target="_blank" rel="noreferrer" onClick={(event) => { if (openExternal(submission.url!)) event.preventDefault(); }}>{t.openSubmission}</a></>}
    </p>}
  </div>;
};
export const HomeworkDetailsEditor = ({ deadline, submission, onDeadline, onSubmission }: Details & {
  onDeadline: (value: Deadline) => void; onSubmission: (value: Submission | null) => void;
}) => {
  const { t } = useI18n();
  const kind = deadline?.kind ?? 'lesson';
  const invalidLink = submission?.url && (() => { try { const url = new URL(submission.url!); return url.protocol !== 'https:' || !!url.username || !!url.password; } catch { return true; } })();
  return <div className="hw-details-editor">
    <label className="field-label">{t.deadlineLabel}
      <select className="field" value={kind} onChange={(event) => onDeadline({ kind: event.target.value as Deadline['kind'] })}>
        {Object.entries(t.deadlineKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {kind === 'date' && <label className="field-label">{t.deadlineUniversityTime}
      <input className="field" type="datetime-local" required value={deadline?.local ?? ''} onInput={(event) => onDeadline({ kind: 'date', local: event.currentTarget.value })} onChange={(event) => onDeadline({ kind: 'date', local: event.target.value })} />
    </label>}
    <label className="field-label">{t.submissionLabel}
      <select className="field" value={submission?.kind ?? ''} onChange={(event) => onSubmission(event.target.value ? { kind: event.target.value as Submission['kind'], label: submission?.label ?? '', url: submission?.url ?? null } : null)}>
        <option value="">{t.optionalField}</option>
        {Object.entries(t.submissionKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {submission && <>
      <label className="field-label">{t.submissionNote}<input className="field" value={submission.label ?? ''} maxLength={200} onChange={(event) => onSubmission({ ...submission, label: event.target.value })} /></label>
      <label className="field-label">{t.submissionLink}<input className="field" type="url" inputMode="url" value={submission.url ?? ''} aria-invalid={!!invalidLink} onChange={(event) => onSubmission({ ...submission, url: event.target.value || null })} /></label>
      {invalidLink && <p className="callout callout--error" role="alert">{t.httpsOnly}</p>}
    </>}
  </div>;
};
