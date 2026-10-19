import { DateField } from './DateField';
import { useState, type ReactNode } from 'react';
import type { Deadline, Submission } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { formatMoment } from '../lib/date';
import { openExternal } from '../bridge/max';
import { ChevronDown, ClockIcon, SendIcon } from './Icon';
import { universityClock } from '../lib/universities';

type Details = { deadline?: Deadline; submission?: Submission | null; dueAt?: string | null; completed?: boolean };

// Срок и способ сдачи — две короткие строки под текстом ДЗ.
export const HomeworkDetails = ({ deadline, submission, dueAt, completed }: Details) => {
  const { t } = useI18n();
  const overdue = !completed && dueAt && Date.parse(dueAt) < Date.now();
  return <ul className="hw-meta">
    <li><ClockIcon size={16} /><span>{t.deadlineLabel}: {dueAt ? formatMoment(dueAt) : t.deadlineKinds[deadline?.kind ?? 'lesson']}</span>
      {overdue && <span className="badge badge--danger">{t.overdue}</span>}</li>
    {submission && <li><SendIcon size={16} /><span>{t.submissionLabel}: {t.submissionKinds[submission.kind]}{submission.label ? ` · ${submission.label}` : ''}</span>
      {submission.url && <a className="text-button" href={submission.url} target="_blank" rel="noreferrer" onClick={(event) => { if (openExternal(submission.url!)) event.preventDefault(); }}>{t.openSubmission}</a>}
    </li>}
  </ul>;
};

// Нативный список: на телефоне открывается системное колесо выбора.
export const Select = ({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) => (
  <label className="field-label">{label}
    <span className="select-field__box">
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
      <ChevronDown size={18} />
    </span>
  </label>
);

export const HomeworkDetailsEditor = ({ deadline, submission, onDeadline, onSubmission, standalone = false, groupId }: Details & {
  standalone?: boolean; groupId: string | number;
  onDeadline: (value: Deadline) => void; onSubmission: (value: Submission | null) => void;
}) => {
  const { t } = useI18n();
  const kind = deadline?.kind ?? 'lesson';
  const [linkTouched, setLinkTouched] = useState(false);
  const invalidLink = submission?.url && (() => { try { const url = new URL(submission.url!); return url.protocol !== 'https:' || !!url.username || !!url.password; } catch { return true; } })();
  return <div className="form-group">
    {!standalone && <Select label={t.deadlineLabel} value={kind} onChange={(value) => onDeadline({ kind: value as Deadline['kind'] })}>
      {Object.entries(t.deadlineKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>}
    {kind === 'date' && <DateField type="datetime-local" label={t.deadlineUniversityTime(universityClock(groupId))} required value={deadline?.local ?? ''} onChange={(local) => onDeadline({ kind: 'date', local })} />}
    <Select label={t.submissionLabel} value={submission?.kind ?? ''} onChange={(value) => {
      const next = value as Submission['kind'];
      onSubmission(next ? { kind: next, label: next === 'class' || next === 'moodle' ? '' : submission?.label ?? '', url: next === 'class' || next === 'email' ? null : submission?.url ?? null } : null);
    }}>
      <option value="">{t.optionalField}</option>
      {Object.entries(t.submissionKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
    {submission && submission.kind !== 'class' && <>
      {submission.kind !== 'moodle' && <label className="field-label">{t.submissionNote}<input className="field" value={submission.label ?? ''} maxLength={200} onChange={(event) => onSubmission({ ...submission, label: event.target.value })} /></label>}
      {submission.kind !== 'email' && <label className="field-label">{t.submissionLink}<input className="field" type="url" inputMode="url" placeholder="https://…" value={submission.url ?? ''} aria-invalid={linkTouched && !!invalidLink} onBlur={() => { setLinkTouched(true); const value = submission.url?.trim(); if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) onSubmission({ ...submission, url: `https://${value}` }); }} onChange={(event) => onSubmission({ ...submission, url: event.target.value || null })} /></label>}
      {linkTouched && invalidLink && <p className="callout callout--error" role="alert">{t.httpsOnly}</p>}
    </>}
  </div>;
};
