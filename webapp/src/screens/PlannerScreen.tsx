import { daySwipe } from '../lib/day-swipe.mjs';
import { DateField } from '../components/DateField';
import { HomeworkDetailsEditor } from '../components/HomeworkDetails';
import type { Deadline, Submission } from '../data/homework';
import { AttachmentEditor, type HomeworkAttachment } from '../components/HomeworkAttachments';
import { dateInZone, localMoment, lessonTime } from '../lib/timezone';
import { lessonKindName } from '../lib/lessonKind';
import { useEffect, useRef, useState } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { homeworkKey, saveHomework, useRemoteHomework } from '../data/homework';
import { addDays, formatDay, formatRange, fromDateKey, startOfWeek, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { loadLessons } from '../lib/lessons';
import { loadAnnouncements, type Announcement } from '../lib/api';
import { buildTasks, lessonFromHomework } from '../lib/tasks';
import { haptic } from '../bridge/max';
import { TopBar } from '../components/TopBar';
import { TaskList } from '../components/TaskList';
import { AnnouncementSheet } from '../components/AnnouncementSheet';
import { ReminderPicker } from '../components/ReminderPicker';
import { Sheet } from '../components/Sheet';
import { groupTimeZone } from '../lib/universities';
import { Empty, ErrorState, ScheduleSkeleton } from '../components/Status';
import { ChevronLeft, ChevronRight, PlusIcon } from '../components/Icon';

const MAX_LENGTH = 2_000;

type Props = {
  profile: LocalProfile;
  profileRevision: number;
  onOpenLesson: (lesson: Lesson) => void;
  onOpenProfile: () => void;
};

// Планер: та же лента дней, что в расписании, но под ней — задачи дня, и можно добавить ДЗ.
export const PlannerScreen = ({ profile, profileRevision, onOpenLesson, onOpenProfile }: Props) => {
  const { t } = useI18n();
  const now = useNow();
  const todayKey = toDateKey(now);
  const [selected, setSelected] = useState(todayKey);
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const weekStart = toDateKey(startOfWeek(fromDateKey(selected)));
  const days = Array.from({ length: 7 }, (_, index) => toDateKey(addDays(fromDateKey(weekStart), index)));
  const [lessons] = useAsync(() => loadLessons(profile.group.id, profile.subgroup, days[0], days[6]), [profile.group.id, profile.subgroup, weekStart], 'PlannerScreen-lessons', revision);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('schedule-changed', update);
    window.addEventListener('focus', update);
    const timer = window.setInterval(() => { if (!document.hidden) update(); }, 30_000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('schedule-changed', update); };
  }, []);
  const [homework, refresh] = useRemoteHomework(profile.group.id, days[0], days[6], `${profileRevision}:${revision}`);

  useEffect(() => {
    let active = true;
    loadAnnouncements().then((data) => active && setAnnouncements(data.items)).catch(() => {});
    return () => { active = false; };
  }, [profileRevision]);

  const weekLessons = lessons.status === 'ready' ? lessons.data : [];
  const items = homework.status === 'ready' ? homework.data.items : [];
  // В планере видно и прошедшие дни недели: удобно проверить, что было задано.
  const tasks = buildTasks(items, announcements, weekLessons, days[0]);
  const dayTasks = tasks.filter((task) => task.date === selected || (selected === todayKey && task.kind === 'homework' && !task.item.completed && task.item.dueAt && Date.parse(task.item.dueAt) < Date.now()));
  const countOn = (key: string) => tasks.filter((task) => task.date === key).length;
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 1 || (event.target as Element).closest('dialog,[role="dialog"],input,textarea,select,a')) { swipe.current = null; return; }
    const touch = event.touches[0]; swipe.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = swipe.current; swipe.current = null;
    if (!start || creating || openAnnouncement) return;
    const touch = event.changedTouches[0]; const delta = daySwipe(start, { x: touch.clientX, y: touch.clientY });
    if (delta) { haptic.tap(); setSelected(toDateKey(addDays(fromDateKey(selected), delta))); }
  };
  const shiftWeek = (weeks: number) => setSelected(toDateKey(addDays(fromDateKey(weekStart), weeks * 7)));

  return (
    <div className="screen screen--tabbed screen--planner">
      <TopBar onOpenProfile={onOpenProfile} left={<h1 className="topbar__title">{t.tabPlanner}</h1>} />

      <div className="week-nav">
        <button type="button" className="icon-button" aria-label={t.previousWeek} onClick={() => shiftWeek(-1)}><ChevronLeft size={18} /></button>
        <div className="planner-calendar"><DateField label={t.fieldDay} value={selected} onChange={(value) => { if (value) setSelected(value); }} displayValue={`${formatRange(fromDateKey(days[0]), fromDateKey(days[6]))}${selected.slice(0, 4) !== todayKey.slice(0, 4) ? ` ${selected.slice(0, 4)}` : ''}`} /></div>
        <button type="button" className="icon-button" aria-label={t.nextWeek} onClick={() => shiftWeek(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="days" role="group" aria-label={t.weekDays}>
        {days.map((key, index) => {
          const count = countOn(key);
          const classes = ['day', key === todayKey && 'day--today', key === selected && 'day--selected', key < todayKey && 'day--past'];
          return (
            <button key={key} type="button" className={classes.filter(Boolean).join(' ')} aria-pressed={key === selected}
              aria-label={`${formatDay(fromDateKey(key))}, ${t.tasksCount(count)}`} onClick={() => { haptic.tap(); setSelected(key); }}>
              <span className="day__weekday">{t.weekdays[index]}</span>
              <span className="day__number">{fromDateKey(key).getUTCDate()}</span>
              <span className="day__ticks day__ticks--tasks" aria-hidden="true">
                {Array.from({ length: Math.min(count, 4) }, (_, tick) => <i key={tick} />)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="block-head block-head--row">
        <h2 className="block-title first-letter">{formatDay(fromDateKey(selected))}</h2>
        <button type="button" className="add-button" onClick={() => setCreating(true)}><PlusIcon size={18} />{t.addTask}</button>
      </div>

      <section className="planner-day" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {homework.status === 'loading' && <ScheduleSkeleton rows={2} />}
      {homework.status === 'error' && <ErrorState message={homework.message} onRetry={() => refresh()} />}
      {homework.status === 'ready' && dayTasks.length === 0 && (
        <Empty title={t.dayFreeTitle}>{selected < todayKey ? t.dayFreePast : t.dayFreeText}</Empty>
      )}
      {dayTasks.length > 0 && (
        <TaskList
          tasks={dayTasks}
          todayKey={todayKey}
          showDate={false}
          onOpenHomework={(task) => onOpenLesson(task.lesson ?? lessonFromHomework(task.item))}
          onOpenAnnouncement={setOpenAnnouncement}
        />
      )}

      </section>
      {creating && (
        <CreateHomeworkSheet
          profile={profile}
          initialDate={selected}
          canShare={homework.status === 'ready' && homework.data.canEditShared}
          now={now}
          onClose={() => setCreating(false)}
          onSaved={(date) => { setRevision((value) => value + 1); setSelected(date); }}
        />
      )}
      {openAnnouncement && (
        <AnnouncementSheet
          item={openAnnouncement}
          now={now}
          onClose={() => setOpenAnnouncement(null)}
          onSaved={(saved) => setAnnouncements((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
        />
      )}
    </div>
  );
};

type CreateProps = {
  profile: LocalProfile;
  initialDate: string;
  canShare: boolean;
  now: Date;
  onClose: () => void;
  onSaved: (date: string) => void;
};

// Новое ДЗ: день, пара этого дня, текст и напоминание. Староста и редакторы могут сразу записать для группы.
const CreateHomeworkSheet = ({ profile, initialDate, canShare, now, onClose, onSaved }: CreateProps) => {
  const { t } = useI18n();
  const [date, setDate] = useState(initialDate);
  const [lessonKey, setLessonKey] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [deadline, setDeadline] = useState<Deadline>({ kind: 'lesson' });
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [filesByScope, setFilesByScope] = useState<{ personal: HomeworkAttachment[]; shared: HomeworkAttachment[] }>({ personal: [], shared: [] });
  const files = filesByScope[scope];
  const [uploading, setUploading] = useState(false);
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lessons] = useAsync(() => loadLessons(profile.group.id, profile.subgroup, date, date), [profile.group.id, profile.subgroup, date], 'PlannerScreen-composer');
  const dayLessons = lessons.status === 'ready' ? lessons.data : [];
  const lesson = dayLessons.find((item) => homeworkKey(item) === lessonKey) ?? null;
  const standalone = !lesson;
  useEffect(() => {
    if (lessons.status === 'loading') return;
    setLessonKey(dayLessons[0] ? homeworkKey(dayLessons[0]) : null);
    setRemindAt(null);
  }, [date, lessons.status]);
  useEffect(() => {
    setDeadline(standalone ? { kind: 'date', local: `${date}T18:00` } : { kind: 'lesson' });
  }, [standalone, date]);
  const reminderDate = standalone && deadline.kind === 'date' && deadline.local?.length === 16 ? dateInZone(new Date(localMoment(deadline.local.slice(0, 10), deadline.local.slice(11), groupTimeZone(profile.group.id)))) : date;
  const save = async () => {
    if ((!lesson && !subject.trim()) || (!text.trim() && !files.length) || saving || uploading || lessons.status === 'loading') return;
    setSaving(true); setError(null);
    try {
      const target = lesson ?? { groupId: profile.group.id, date, lessonNumber: 0, subgroup: profile.subgroup, standalone: true };
      const saved = await saveHomework(target, text.trim(), scope, remindAt, undefined, undefined, files,
        { deadline, submission, ...(standalone ? { standalone: true, subject: subject.trim() } : {}) });
      haptic.success();
      onSaved(saved.item?.dueAt ? dateInZone(new Date(saved.item.dueAt)) : date);
      onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  };
  return <Sheet title={t.newHomework} labelId="create-homework" onClose={onClose} busy={saving}>
    <div className="homework-compose">
      <DateField label={t.fieldDay} value={date} onChange={(value) => { if (value) setDate(value); }} required />
      {lessons.status === 'loading' && <ScheduleSkeleton rows={1} />}
      {dayLessons.length > 0 && <fieldset className="compose-lessons"><legend className="field-label">{t.fieldSubject}</legend>
        <div className="choice-list choice-list--compact" role="radiogroup" aria-label={t.fieldSubject}>
          {dayLessons.map((item) => <button key={homeworkKey(item)} type="button" role="radio" className="choice choice--compact" aria-checked={homeworkKey(item) === lessonKey} onClick={() => setLessonKey(homeworkKey(item))}>
            <span className="choice__text"><span className="choice__title">{item.subject}</span><span className="choice__hint">{lessonTime(item)} · {lessonKindName(item.lessonType)}</span></span>
          </button>)}
          <button type="button" role="radio" className="choice choice--compact" aria-checked={standalone} onClick={() => setLessonKey(null)}><span className="choice__text"><span className="choice__title">{t.withoutLesson}</span></span></button>
        </div>
      </fieldset>}
      {standalone && lessons.status !== 'loading' && <label className="field-label">{t.assignmentTitle}<input className="field" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} placeholder={t.assignmentExample} /></label>}
      {canShare && <div className="compose-scope"><p className="field-label">{t.fieldWho}</p>
        <div className="segment segment--wide" role="radiogroup" aria-label={t.fieldWho}>
          <button type="button" role="radio" disabled={uploading} aria-selected={scope === 'personal'} aria-checked={scope === 'personal'} onClick={() => setScope('personal')}>{t.forMe}</button>
          <button type="button" role="radio" disabled={uploading} aria-selected={scope === 'shared'} aria-checked={scope === 'shared'} onClick={() => setScope('shared')}>{t.forGroup}</button>
        </div>
      </div>}
      <div className="editor__body"><label className="field-label" htmlFor="new-task-text">{t.fieldTask}</label>
        <Textarea id="new-task-text" rows={4} maxLength={MAX_LENGTH} placeholder={t.placeholder} value={text} onChange={(event) => setText(event.target.value)} />
        <AttachmentEditor key={scope} files={files} scope={scope} onChange={(next) => setFilesByScope((current) => ({ ...current, [scope]: next }))} onBusy={setUploading} />
      </div>
      <HomeworkDetailsEditor groupId={profile.group.id} standalone={standalone} deadline={deadline} submission={submission} onDeadline={setDeadline} onSubmission={setSubmission} />
      <ReminderPicker value={remindAt} onChange={setRemindAt} dateKey={reminderDate} now={now} />
      {error && <p className="toast toast--error" role="alert">{error}</p>}
      <Button stretched size="large" disabled={lessons.status === 'loading' || (standalone && !subject.trim()) || uploading || (!text.trim() && !files.length)} loading={saving} onClick={save}>{t.save}</Button>
    </div>
  </Sheet>;
};
