import { useEffect, useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { apiRequest } from '../lib/api';
import { formatStamp } from '../lib/date';
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
  return <section>
    <div className="block-head"><h2 className="block-title">{t.moveMarks}</h2></div>
    {moves.map((item) => <div key={item.id} className="hw-block">
      <p>{item.from.subject} · {item.from.date} · {item.to ? `${item.to.date}, ${item.to.time}` : t.moveCancelled}</p>
      <p>{t.moveMarked(item.authorName, formatStamp(item.at))}</p>
      <Button stretched variant="secondary" onClick={() => void revoke(item.id)}>{t.moveUndo}</Button>
    </div>)}
    <div className="block-head"><h2 className="block-title">{t.orphanedList}</h2></div>
    {error && <p role="alert">{error}</p>}
    {items.length === 0 && <p className="block-note">{t.orphanedEmpty}</p>}
    {items.map((item) => <div key={item.id} className="hw-block">
      <p>{item.date} · {item.subject}</p><p>{t.orphaned}</p><p>{item.text}</p>
      <LessonMove lesson={item} groupId={item.groupId} orphanId={item.id} onSaved={() => void reload()} />
      <Button stretched variant="destructive" onClick={() => void remove(item.id)}>{confirm === item.id ? t.confirmDelete : t.deleteShared}</Button>
    </div>)}
  </section>;
};
