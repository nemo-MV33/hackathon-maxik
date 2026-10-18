import { CheckIcon } from './Icon';
import { useState } from 'react';
import { completeHomework, type HomeworkItem } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { haptic } from '../bridge/max';

export const HomeworkCompletion = ({ item, onSaved }: { item: HomeworkItem; onSaved?: () => void }) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!item.completionRevision) return null;
  return <div className="completion">
    <button type="button" className="completion__button" aria-pressed={Boolean(item.completed)} disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await completeHomework(item, !item.completed); haptic.success(); onSaved?.(); }
      catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}><span className="completion__check" aria-hidden="true">{item.completed && <CheckIcon size={16} />}</span>{item.completed ? t.homeworkDone : t.completeHomework}</button>
    {error && <p className="toast toast--error" role="alert">{error}</p>}
  </div>;
};
