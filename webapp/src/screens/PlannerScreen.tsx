import { useEffect, useState } from 'react';
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
  const [lessons, retry] = useAsync(() => loadLessons(profile.group.id, profile.subgroup, days[0], days[6]), [profile.group.id, profile.subgroup, weekStart]);
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
  const dayTasks = tasks.filter((task) => task.date === selected);
  const countOn = (key: string) => tasks.filter((task) => task.date === key).length;
  const shiftWeek = (weeks: number) => setSelected(toDateKey(addDays(fromDateKey(weekStart), weeks * 7)));

  return (
    <div className="screen screen--tabbed screen--planner">
      <TopBar onOpenProfile={onOpenProfile} left={<h1 className="topbar__title">{t.tabPlanner}</h1>} />

      <div className="week-nav">
        <button type="button" className="icon-button" aria-label={t.previousWeek} onClick={() => shiftWeek(-1)}><ChevronLeft size={18} /></button>
        <span className="week-nav__range">{formatRange(fromDateKey(days[0]), fromDateKey(days[6]))}</span>
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

      {homework.status === 'loading' && <ScheduleSkeleton rows={2} />}
      {homework.status === 'error' && <ErrorState message={homework.message} onRetry={() => refresh()} />}
      {lessons.status === 'error' && <ErrorState message={lessons.message} onRetry={retry} />}
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

      {creating && (
        <CreateHomeworkSheet
          profile={profile}
          initialDate={selected < todayKey ? todayKey : selected}
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

// Новое ДЗ: день → пара этого дня → текст → напоминание. Староста и редакторы могут сразу записать для группы.
const CreateHomeworkSheet = ({ profile, initialDate, canShare, now, onClose, onSaved }: CreateProps) => {
  const { t } = useI18n();
  const todayKey = toDateKey(now);
  const [date, setDate] = useState(initialDate);
  const [lessonKey, setLessonKey] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const horizon = toDateKey(addDays(now, 28));
  const [lessons] = useAsync(() => loadLessons(profile.group.id, profile.subgroup, todayKey, horizon), [profile.group.id, profile.subgroup, todayKey]);
  const all = lessons.status === 'ready' ? lessons.data : [];
  const lessonDays = [...new Set(all.map((lesson) => lesson.date))];
  const dayLessons = all.filter((lesson) => lesson.date === date);
  const lesson = dayLessons.find((item) => homeworkKey(item) === lessonKey) ?? null;

  useEffect(() => {
    if (lessons.status !== 'ready') return;
    if (!lessonDays.includes(date) && lessonDays.length) setDate(lessonDays.find((key) => key >= date) ?? lessonDays[0]);
  }, [lessons.status]);
  useEffect(() => { setLessonKey(dayLessons[0] ? homeworkKey(dayLessons[0]) : null); setRemindAt(null); }, [date, lessons.status]);

  const save = async () => {
    if (!lesson || !text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveHomework(lesson, text.trim(), scope, remindAt);
      haptic.success();
      onSaved(lesson.date);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={t.newHomework} labelId="create-homework" onClose={onClose} busy={saving}>
      {lessons.status === 'loading' && <ScheduleSkeleton rows={1} />}
      {lessons.status === 'error' && <p className="callout callout--error">{lessons.message}</p>}
      {lessons.status === 'ready' && lessonDays.length === 0 && <p className="callout">{t.noLessonsAhead}</p>}
      {lessons.status === 'ready' && lessonDays.length > 0 && (
        <>
          <p className="field-label">{t.fieldDay}</p>
          <div className="chips chips--scroll" role="radiogroup" aria-label={t.fieldDay}>
            {lessonDays.slice(0, 14).map((key) => (
              <button key={key} type="button" role="radio" className="chip-option" aria-checked={date === key} onClick={() => setDate(key)}>
                {key === todayKey ? t.today : key === toDateKey(addDays(now, 1)) ? t.tomorrow : new Intl.DateTimeFormat(t.locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(fromDateKey(key))}
              </button>
            ))}
          </div>

          <p className="field-label">{t.fieldSubject}</p>
          <div className="choice-list choice-list--compact" role="radiogroup" aria-label={t.fieldSubject}>
            {dayLessons.map((item) => (
              <button key={homeworkKey(item)} type="button" role="radio" className="choice choice--compact" aria-checked={homeworkKey(item) === lessonKey} onClick={() => setLessonKey(homeworkKey(item))}>
                <span className="choice__text">
                  <span className="choice__title">{item.subject}</span>
                  <span className="choice__hint">{item.time}, {item.lessonType}{item.subgroup ? `, ${t.subgroupShort(item.subgroup)}` : ''}</span>
                </span>
              </button>
            ))}
          </div>

          <p className="field-label">{t.fieldTask}</p>
          <div className="editor">
            <Textarea rows={3} maxLength={MAX_LENGTH} placeholder={t.placeholder} value={text} onChange={(event) => setText(event.target.value)} />
          </div>

          {canShare && (
            <>
              <p className="field-label">{t.fieldWho}</p>
              <div className="segment segment--wide" role="radiogroup" aria-label={t.fieldWho}>
                <button type="button" role="radio" aria-selected={scope === 'personal'} aria-checked={scope === 'personal'} onClick={() => setScope('personal')}>{t.forMe}</button>
                <button type="button" role="radio" aria-selected={scope === 'shared'} aria-checked={scope === 'shared'} onClick={() => setScope('shared')}>{t.forGroup}</button>
              </div>
              <p className="sheet__hint">{scope === 'shared' ? t.sharedScope : t.ownScope}</p>
            </>
          )}

          <p className="field-label">{t.reminder}</p>
          <ReminderPicker value={remindAt} onChange={setRemindAt} dateKey={date} now={now} />

          {error && <p className="toast toast--error" role="alert">{error}</p>}
          <div className="actions">
            <Button stretched size="large" disabled={!lesson || !text.trim()} loading={saving} onClick={save}>{t.save}</Button>
          </div>
        </>
      )}
    </Sheet>
  );
};
