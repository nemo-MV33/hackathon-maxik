import { useEffect, useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { loadWeek, invalidateSchedule, type Lesson } from '../data/schedule';
import { apiRequest } from '../lib/api';
import { fromDateKey, startOfWeek, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';

export type Move = { id: string; from: Lesson; to: Lesson | null; status: string; authorName: string; at: string };
export const scheduleChanged = () => {
  invalidateSchedule();
  window.dispatchEvent(new Event('schedule-changed'));
};

export const LessonMove = ({ lesson, groupId, orphanId, onSaved }: {
  lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup'>; groupId: number; orphanId?: string; onSaved?: () => void;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(lesson.date);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [target, setTarget] = useState('');
  const [moves, setMoves] = useState<Move[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = (item: typeof lesson) => `${item.date}:${item.lessonNumber}:${item.subgroup ?? 0}`;
  const existing = moves.find((item) => item.status === 'pending' && key(item.to ?? item.from) === key(lesson));
  useEffect(() => {
    apiRequest<{ items: Move[] }>('/api/lesson-changes').then((data) => setMoves(data.items)).catch(() => {});
  }, [open]);
  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let active = true;
    setLessons([]);
    setTarget('');
    loadWeek(groupId, toDateKey(startOfWeek(fromDateKey(date)))).then((week) => {
      if (active) setLessons(week.lessons.filter((item) => item.date === date && item.subgroup === lesson.subgroup && key(item) !== key(lesson)));
    }).catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [date, open, groupId]);
  const submit = async (to: Lesson | null, revoke = false) => {
    setBusy(true);
    setError('');
    try {
      const path = revoke ? `/api/lesson-changes/${existing!.id}` : orphanId ? '/api/homework/orphaned' : '/api/lesson-changes';
      await apiRequest(path, { method: revoke ? 'DELETE' : orphanId ? 'PUT' : 'POST',
        ...(!revoke ? { body: JSON.stringify(orphanId ? { id: orphanId, to } : { from: lesson, to }) } : {}) });
      scheduleChanged();
      setOpen(false);
      setMoves([]);
      onSaved?.();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="hw-block">
    {!open && <Button stretched variant="secondary" onClick={() => setOpen(true)}>{orphanId ? t.moveRebind : t.moveAction}</Button>}
    {open && <div className="editor">
      {existing ? <Button stretched disabled={busy} onClick={() => void submit(null, true)}>{t.moveUndo}</Button> : <>
        <label className="field-label">{t.moveDate}<input type="date" value={date} onInput={(event) => setDate(event.currentTarget.value)} /></label>
        <label className="field-label">{t.moveChoose}<select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">{t.moveChoose}</option>
          {lessons.map((item) => <option key={key(item)} value={key(item)}>{item.time} · {item.subject}</option>)}
        </select></label>
        <Button stretched loading={busy} disabled={!target || busy} onClick={() => void submit(lessons.find((item) => key(item) === target)!)}>{t.save}</Button>
        {!orphanId && <Button stretched disabled={busy} variant="secondary" onClick={() => void submit(null)}>{t.moveCancelled}</Button>}
      </>}
      <Button stretched variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t.cancel}</Button>
    </div>}
    {error && <p className="toast toast--error" role="alert">{error}</p>}
  </div>;
};
