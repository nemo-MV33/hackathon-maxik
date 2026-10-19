import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { formatShortDay, formatStamp } from '../lib/date';
import { useI18n } from '../lib/i18n';
import type { HomeworkItem } from '../data/homework';
import { LessonMove, scheduleChanged, type Move } from './LessonMove';

export const OrphanedHomework = () => {
  const { t } = useI18n();
  const [items, setItems] = useState<(HomeworkItem & { id: string })[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const reload = () => Promise.all([apiRequest<{ items: typeof items }>('/api/homework/orphaned'), apiRequest<{ items: Move[] }>('/api/lesson-changes')])
    .then(([data, marks]) => { setItems(data.items); setMoves(marks.items.filter((item) => item.status === 'pending')); }).catch((failure: Error) => setError(failure.message));
  useEffect(() => { void reload(); }, []);
  const remove = async (id: string) => {
    if (confirm !== id) { setConfirm(id); return; }
    try {
      await apiRequest('/api/homework/orphaned', { method: 'DELETE', body: JSON.stringify({ id }) });
      scheduleChanged();
      await reload();
    } catch (failure) { setError((failure as Error).message); }
  };
  const revoke = async (id: string) => {
    try {
      await apiRequest(`/api/lesson-changes/${id}`, { method: 'DELETE' });
      scheduleChanged();
      await reload();
    } catch (failure) { setError((failure as Error).message); }
  };
  return <div className="orphans">
    {error && <p className="callout callout--error" role="alert">{error}</p>}
    {moves.length > 0 && <>
      <p className="field-label">{t.moveMarks}</p>
      {moves.map((item) => <article key={item.id} className="hw-block">
        <p className="task__title">{item.from.subject}</p>
        <p className="hw-block__meta">{formatShortDay(item.from.date)}, {item.from.time?.slice(0, 5)} → {item.to ? `${formatShortDay(item.to.date)}, ${item.to.time?.slice(0, 5)}` : t.moveCancelled}</p>
        <p className="hw-block__meta">{t.moveMarked(item.authorName, formatStamp(item.at))}</p>
        <button type="button" className="text-button" onClick={() => void revoke(item.id)}>{t.moveUndo}</button>
      </article>)}
    </>}
    <p className="field-label">{t.orphanedList}</p>
    {items.length === 0 && <p className="hint">{t.orphanedEmpty}</p>}
    {items.map((item) => <article key={item.id} className="hw-block">
      <p className="task__title">{item.subject}</p>
      <p className="hw-block__meta">{formatShortDay(item.date)} · {t.orphaned}</p>
      {item.text && <p className="hw-block__text">{item.text}</p>}
      <LessonMove lesson={item} groupId={item.groupId} orphanId={item.id} onSaved={() => void reload()} />
      <button type="button" className={`text-button text-button--danger${confirm === item.id ? ' is-confirm' : ''}`} onClick={() => void remove(item.id)}>{confirm === item.id ? t.confirmDelete : t.deleteShared}</button>
    </article>)}
  </div>;
};
