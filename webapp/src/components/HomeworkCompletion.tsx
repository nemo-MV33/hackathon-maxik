import { CheckIcon } from './Icon';
import { useState } from 'react';
import { completeHomework, type HomeworkItem } from '../data/homework';
import { useI18n } from '../lib/i18n';
import { haptic } from '../bridge/max';

// Личная отметка «сделано». compact — круглая галочка в списке задач, иначе строка с подписью в карточке ДЗ.
export const HomeworkCompletion = ({ item, onSaved, compact = false }: { item: HomeworkItem; onSaved?: () => void; compact?: boolean }) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!item.completionRevision) return null;
  const toggle = async () => {
    setBusy(true); setError('');
    try { await completeHomework(item, !item.completed); haptic.success(); onSaved?.(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  if (compact) {
    return <button type="button" className="task-check" aria-pressed={Boolean(item.completed)} disabled={busy}
      aria-label={item.completed ? t.homeworkDone : t.completeHomework} title={error || undefined} onClick={toggle}>
      <CheckIcon size={16} />
    </button>;
  }
  return <div className="completion">
    <button type="button" className="completion__button" aria-pressed={Boolean(item.completed)} disabled={busy} onClick={toggle}>
      <span className="completion__check" aria-hidden="true"><CheckIcon size={15} /></span>
      {item.completed ? t.homeworkDone : t.completeHomework}
    </button>
    {error && <p className="toast toast--error" role="alert">{error}</p>}
  </div>;
};
