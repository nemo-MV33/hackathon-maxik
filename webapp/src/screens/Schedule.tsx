import { useEffect, useRef, useState } from 'react';
import { loadMeta, loadWeek, type Lesson } from '../data/schedule';
import {
  addDays, formatDay, formatRange, formatUpdatedAt, fromDateKey, startOfWeek, toDateKey,
} from '../lib/date';
import { useI18n } from '../lib/i18n';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { haptic } from '../bridge/max';
import { DayTimeline, lessonEnd, lessonStart } from '../components/Timeline';
import { Empty, ErrorState, ScheduleSkeleton } from '../components/Status';
import { ChevronLeft, ChevronRight, SearchIcon } from '../components/Icon';
import { TopBar } from '../components/TopBar';
import { ScheduleSearch } from '../components/ScheduleSearch';
import type { EntityTarget } from './EntityScheduleScreen';
import { AbsenceSheet } from '../components/AbsenceSheet';
import type { AbsenceKind } from '../lib/api';
import type { LaunchTarget } from '../App';
import { homeworkKey, useRemoteHomework } from '../data/homework';

type Mode = 'day' | 'week';

const MODE_KEY = 'norfly.mode';

const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'week' ? 'week' : 'day';
  } catch {
    return 'day';
  }
};

const forSubgroup = (lessons: Lesson[], subgroup: 1 | 2 | null) =>
  lessons.filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup);

const pairCount = (lessons: Lesson[]) => new Set(lessons.map((lesson) => lesson.lessonNumber)).size;

const dayDiff = (key: string, todayKey: string) =>
  Math.round((fromDateKey(key).getTime() - fromDateKey(todayKey).getTime()) / 86_400_000);

type DayHeadingProps = { dateKey: string; todayKey: string; lessons: Lesson[]; level?: 'h1' | 'h2'; loading?: boolean };

// Заголовок дня в одну строку: «Завтра · понедельник, 28 сентября», под ним — сколько пар и во сколько.
export const DayHeading = ({ dateKey, todayKey, lessons, level = 'h1', loading = false }: DayHeadingProps) => {
  const { t } = useI18n();
  const Tag = level;
  const diff = dayDiff(dateKey, todayKey);
  const relative = { 0: t.today, 1: t.tomorrow, 2: t.dayAfterTomorrow, [-1]: t.yesterday }[diff];
  return (
    <div className={`day-heading day-heading--${level}`}>
      <div className="day-heading__row">
        {relative && <span className={`day-heading__eyebrow${diff === 0 ? ' is-today' : ''}`}>{relative}</span>}
        <Tag className="day-heading__title first-letter">{formatDay(fromDateKey(dateKey))}</Tag>
      </div>
      {/* Пока неделя не загрузилась, строка пустая той же высоты: «Пар нет» до данных было бы неправдой. */}
      <span className="day-heading__summary">
        {loading ? '\u00a0' : lessons.length > 0
          ? `${t.pairs(pairCount(lessons))} · ${lessonStart(lessons[0])}–${lessonEnd(lessons[lessons.length - 1])}`
          : t.noLessonsTitle}
      </span>
    </div>
  );
};

type ScheduleProps = {
  profile: LocalProfile;
  profileRevision: number;
  launch?: LaunchTarget;
  onLaunchHandled?: () => void;
  onOpenLesson: (lesson: Lesson) => void;
  onOpenProfile: () => void;
  onOpenEntity: (target: EntityTarget) => void;
};

export const Schedule = ({
  profile, profileRevision, launch, onLaunchHandled, onOpenLesson, onOpenProfile, onOpenEntity,
}: ScheduleProps) => {
  const { t } = useI18n();
  const now = useNow();
  const todayKey = toDateKey(now);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [selected, setSelected] = useState(launch?.date ?? todayKey);
  const [absence, setAbsence] = useState<{ kind: AbsenceKind; lesson: Lesson } | null>(null);
  const [searching, setSearching] = useState(false);
  const openAbsence = (kind: AbsenceKind, lesson: Lesson) => setAbsence({ kind, lesson });
  const todayRef = useRef<HTMLElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const setMode = (value: Mode) => {
    setModeState(value);
    try { localStorage.setItem(MODE_KEY, value); } catch {}
  };

  const weekStart = toDateKey(startOfWeek(fromDateKey(selected)));
  const days = Array.from({ length: 7 }, (_, index) => toDateKey(addDays(fromDateKey(weekStart), index)));

  const [meta] = useAsync(loadMeta, []);
  const [week, retry] = useAsync(() => loadWeek(profile.group.id, weekStart), [profile.group.id, weekStart]);

  const [homework] = useRemoteHomework(profile.group.id, days[0], days[6], profileRevision);
  const remoteHomework = homework.status === 'ready'
    ? new Map(homework.data.items.map((item) => [homeworkKey(item), item]))
    : null;

  const availableWeeks = meta.status === 'ready' ? meta.data.weeks : [];
  const lessons = week.status === 'ready' ? forSubgroup(week.data.lessons, profile.subgroup) : [];
  const lessonsOn = (key: string) => lessons.filter((lesson) => lesson.date === key);

  const weekKeyOf = (offset: number) => toDateKey(addDays(fromDateKey(weekStart), offset * 7));
  const canShift = (weeks: number) => availableWeeks.includes(weekKeyOf(weeks));
  const shiftWeek = (weeks: number) => {
    const target = weekKeyOf(weeks);
    const sameWeekday = toDateKey(addDays(fromDateKey(target), (fromDateKey(selected).getUTCDay() + 6) % 7));
    setSelected(target === toDateKey(startOfWeek(now)) ? todayKey : sameWeekday);
  };
  const shiftDay = (delta: number) => {
    const target = toDateKey(addDays(fromDateKey(selected), delta));
    const targetWeek = toDateKey(startOfWeek(fromDateKey(target)));
    if (targetWeek !== weekStart && !availableWeeks.includes(targetWeek)) return;
    haptic.tap();
    setSelected(target);
  };

  useEffect(() => {
    if (mode === 'week' && week.status === 'ready') todayRef.current?.scrollIntoView({ block: 'start' });
  }, [mode, week.status]);

  useEffect(() => {
    if (!launch || week.status !== 'ready') return;
    if (mode !== 'day') setMode('day');
    const target = launch.lessonNumber
      ? week.data.lessons.find((lesson) => lesson.date === launch.date
        && lesson.lessonNumber === launch.lessonNumber && (lesson.subgroup ?? null) === (launch.subgroup ?? null))
      : undefined;
    onLaunchHandled?.();
    if (target) onOpenLesson(target);
  }, [launch, week.status]);

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    swipe.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || mode !== 'day') return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6) shiftDay(dx < 0 ? 1 : -1);
  };

  const selectedLessons = lessonsOn(selected);
  const weekDays = days.filter((key) => lessonsOn(key).length > 0);

  return (
    <div className="screen screen--tabbed screen--schedule">
      <TopBar
        onOpenProfile={onOpenProfile}
        left={(
          <div className="segment" role="tablist" aria-label={t.scheduleView}>
            {(['day', 'week'] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setSearching(false); }}>
                {value === 'day' ? t.day : t.week}
              </button>
            ))}
          </div>
        )}
        extra={(
          <button type="button" className={`icon-button icon-button--lg${searching ? ' is-active' : ''}`} aria-label={t.searchSchedule} aria-pressed={searching} onClick={() => setSearching((value) => !value)}>
            <SearchIcon size={18} />
          </button>
        )}
      />

      {searching && <ScheduleSearch onOpen={onOpenEntity} onClose={() => setSearching(false)} />}
      {!searching && (<>

      {mode === 'day' && <DayHeading dateKey={selected} todayKey={todayKey} lessons={selectedLessons} loading={week.status !== 'ready'} />}

      <div className="week-nav">
        <button type="button" className="icon-button" aria-label={t.previousWeek} disabled={!canShift(-1)} onClick={() => shiftWeek(-1)}>
          <ChevronLeft size={18} />
        </button>
        <span className="week-nav__range">
          {formatRange(fromDateKey(days[0]), fromDateKey(days[6]))}
          {week.status === 'ready' && <span className="week-nav__parity"> · {week.data.weekEven ? t.even : t.odd}</span>}
        </span>
        <button type="button" className="icon-button" aria-label={t.nextWeek} disabled={!canShift(1)} onClick={() => shiftWeek(1)}>
          <ChevronRight size={18} />
        </button>
      </div>

      {mode === 'day' && (
        <div className="days" role="group" aria-label={t.weekDays}>
          {days.map((key, index) => {
            const count = new Set(lessonsOn(key).map((lesson) => lesson.lessonNumber)).size;
            const classes = ['day', key === todayKey && 'day--today', key === selected && 'day--selected', key < todayKey && 'day--past'];
            return (
              <button
                key={key}
                type="button"
                className={classes.filter(Boolean).join(' ')}
                aria-pressed={key === selected}
                aria-label={`${formatDay(fromDateKey(key))}, ${count ? t.pairs(count) : t.noPairs}`}
                onClick={() => setSelected(key)}
              >
                <span className="day__weekday">{t.weekdays[index]}</span>
                <span className="day__number">{fromDateKey(key).getUTCDate()}</span>
                <span className="day__ticks" aria-hidden="true">
                  {Array.from({ length: Math.min(count, 6) }, (_, tick) => <i key={tick} />)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {week.status === 'error' && <ErrorState message={week.message} onRetry={retry} />}

      {mode === 'day' && week.status !== 'error' && (
        <section className="day-view" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {week.status === 'loading' && <ScheduleSkeleton />}
          {week.status === 'ready' && (selectedLessons.length === 0
            ? <Empty title={t.noLessonsTitle}>{selected < todayKey ? t.noLessonsPast : t.noLessonsFree}</Empty>
            : <DayTimeline lessons={selectedLessons} dateKey={selected} todayKey={todayKey} now={now} homework={remoteHomework} onOpen={onOpenLesson} onAbsence={openAbsence} />)}
        </section>
      )}

      {mode === 'week' && week.status === 'loading' && <ScheduleSkeleton rows={5} />}
      {mode === 'week' && week.status === 'ready' && (weekDays.length === 0
        ? <Empty title={t.emptyWeekTitle}>{t.emptyWeekText}</Empty>
        : weekDays.map((key) => (
          <section key={key} className="week-day" ref={key === todayKey ? todayRef : undefined}>
            <DayHeading dateKey={key} todayKey={todayKey} lessons={lessonsOn(key)} level="h2" />
            <DayTimeline lessons={lessonsOn(key)} dateKey={key} todayKey={todayKey} now={now} homework={remoteHomework} onOpen={onOpenLesson} onAbsence={openAbsence} />
          </section>
        )))}

      {absence && <AbsenceSheet kind={absence.kind} lesson={absence.lesson} onClose={() => setAbsence(null)} />}

      {meta.status === 'ready' && (
        <p className="footnote">{t.footnote(formatUpdatedAt(meta.data.updatedAt))}</p>
      )}
      </>)}
    </div>
  );
};
