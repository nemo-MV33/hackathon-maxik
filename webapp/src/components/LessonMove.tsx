import { DateField } from './DateField';
import { useEffect, useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { loadWeek, invalidateSchedule, type Lesson } from '../data/schedule';
import { apiRequest } from '../lib/api';
import { fromDateKey, startOfWeek, toDateKey } from '../lib/date';
import { lessonDate, lessonTime } from '../lib/timezone';
import { useI18n } from '../lib/i18n';

export type Move = { id: string; from: Lesson; to: Lesson | null; status: string; authorName: string; at: string };
export const scheduleChanged = () => {
  invalidateSchedule();
  window.dispatchEvent(new Event('schedule-changed'));
  window.dispatchEvent(new Event('homework-changed'));
};

export const LessonMove = ({ lesson, groupId, orphanId, onSaved }: {
  lesson: Pick<Lesson, 'date' | 'lessonNumber' | 'subgroup'> & Partial<Lesson>; groupId: string | number; orphanId?: string; onSaved?: () => void;
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'move' | 'cancel' | null>(null);
  const [date, setDate] = useState(lesson.date);
  const [begin, setBegin] = useState(lesson.time?.slice(0, 5) ?? '08:15');
  const [end, setEnd] = useState(lesson.time?.slice(6, 11) ?? '09:45');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [target, setTarget] = useState('');
  const [moves, setMoves] = useState<Move[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = (item: typeof lesson) => `${item.date}:${item.lessonNumber}:${item.subgroup ?? 0}`;
  const existing = moves.find((item) => item.status === 'pending' && key(item.to ?? item.from) === key(lesson));
  useEffect(() => {
    apiRequest<{ items: Move[] }>('/api/lesson-changes').then((data) => setMoves(data.items)).catch(() => {});
  }, [mode]);
  useEffect(() => {
    if (mode !== 'move' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let active = true;
    setTarget('');
    loadWeek(groupId, toDateKey(startOfWeek(fromDateKey(date)))).then((week) => {
      if (active) setLessons(week.lessons.filter((item) => item.date === date && (orphanId ? item.subgroup === lesson.subgroup : !item.subgroup || !lesson.subgroup || item.subgroup === lesson.subgroup) && key(item) !== key(lesson)));
    }).catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [date, mode, groupId, orphanId]);
  const overlaps = !orphanId && lessons.some((item) => item.time.slice(0, 5) < end && item.time.slice(6, 11) > begin);
  const submit = async (revoke = false) => {
    revoke ||= Boolean(existing && mode === 'move' && date === existing.from.date && `${begin}–${end}` === existing.from.time);
    setBusy(true); setError('');
    try {
      const to = mode === 'cancel' ? null : orphanId ? lessons.find((item) => key(item) === target) : { custom: true, date, time: `${begin}–${end}` };
      const path = revoke ? `/api/lesson-changes/${existing!.id}` : orphanId ? '/api/homework/orphaned' : '/api/lesson-changes';
      await apiRequest(path, { method: revoke ? 'DELETE' : orphanId ? 'PUT' : 'POST',
        ...(!revoke ? { body: JSON.stringify(orphanId ? { groupId, id: orphanId, to } : { groupId, from: existing?.from ?? lesson, to }) } : {}) });
      scheduleChanged(); setMode(null); setMoves([]); onSaved?.();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="lesson-move">
    {!mode && <div className="lesson-move__actions">
      <Button stretched variant="secondary" onClick={() => setMode('move')}>{existing ? t.moveManage : orphanId ? t.moveRebind : t.moveAction}</Button>
      {!existing && !orphanId && <button type="button" className="text-button lesson-move__cancel" onClick={() => setMode('cancel')}>{t.cancelLessonAction}</button>}
    </div>}
    {mode && <div className="editor move-editor">
      {mode === 'cancel' ? <>
        <p className="lead">{t.cancelLessonQuestion}</p><p className="hint">{t.cancelLessonHint}</p>
        <Button stretched variant="destructive" disabled={busy} onClick={() => void submit()}>{t.cancelLessonConfirm}</Button>
      </> : <>
        {existing && <p className="hint">{t.moveAlreadyMarked}</p>}
        <p className="hint">{t.moveUniversityTime}</p>
        <DateField label={t.moveDate} value={date} onChange={setDate} />
        {orphanId ? <label className="field-label">{t.moveChoose}<select className="field" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">{t.moveChoose}</option>{lessons.map((item) => <option key={key(item)} value={key(item)}>{lessonTime(item)} · {item.subject}</option>)}</select></label> : <div className="field-pair">
          <DateField type="time" label={t.classStarts} value={begin} onChange={setBegin} />
          <DateField type="time" label={t.classEnds} value={end} onChange={setEnd} />
        </div>}
        {overlaps && <p className="callout" role="status">{t.moveOverlap}</p>}
        <Button stretched loading={busy} disabled={busy || !date || (orphanId ? !target : !begin || end <= begin || (date === lesson.date && `${begin}–${end}` === lesson.time))} onClick={() => void submit()}>{orphanId ? t.save : t.moveSave}</Button>
        {existing && <Button stretched variant="secondary" disabled={busy} onClick={() => void submit(true)}>{t.moveUndo}</Button>}
      </>}
      <Button stretched variant="ghost" disabled={busy} onClick={() => setMode(null)}>{t.closeForm}</Button>
    </div>}
    {error && <p className="toast toast--error" role="alert">{error}</p>}
  </div>;
};
