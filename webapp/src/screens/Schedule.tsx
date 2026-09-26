import { Fragment, useMemo, useState } from 'react';
import { Typography } from '@maxhub/max-ui';
import { loadMeta, loadWeek, type Lesson } from '../data/schedule';
import {
  addDays, formatDay, formatShortDay, formatUpdatedAt, fromDateKey, irkutskNow, minutesUntil, startOfWeek, toDateKey,
} from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { LessonCard } from '../components/LessonCard';
import { Empty, ErrorState, Loading } from '../components/Status';
import { homeworkKey, useRemoteHomework, type HomeworkItem } from '../data/homework';

type Mode = 'day' | 'week';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const forSubgroup = (lessons: Lesson[], subgroup: 1 | 2 | null) =>
  lessons.filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup);

const endTime = (lesson: Lesson) => lesson.time.slice(6);

const liveLabel = (lesson: Lesson, now: Date) => {
  const untilStart = minutesUntil(lesson.date, lesson.time, now);
  const untilEnd = minutesUntil(lesson.date, endTime(lesson), now);
  if (untilStart <= 0 && untilEnd > 0) return `Идёт сейчас · ещё ${untilEnd} мин`;
  if (untilStart > 0 && untilStart <= 120) return `Через ${untilStart} мин`;
  return undefined;
};

const formatGap = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours && `${hours} ч`, rest && `${rest} мин`].filter(Boolean).join(' ');
};

const toMinutes = (time: string) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

const gapMinutes = (previous: Lesson, next: Lesson) => toMinutes(next.time) - toMinutes(endTime(previous));

type DayProps = {
  lessons: Lesson[];
  dateKey: string;
  now: Date;
  remoteHomework: Map<string, HomeworkItem> | null;
  onOpen: (lesson: Lesson) => void;
};

const DayLessons = ({ lessons, dateKey, now, remoteHomework, onOpen }: DayProps) => {
  const day = lessons.filter((lesson) => lesson.date === dateKey);
  if (day.length === 0) return <Empty>Пар нет — можно отдохнуть</Empty>;
  const isToday = dateKey === toDateKey(now);
  const next = isToday ? day.find((lesson) => minutesUntil(lesson.date, endTime(lesson), now) > 0) : undefined;
  return (
    <div className="stack">
      {day.map((lesson, index) => {
        const previous = day[index - 1];
        const gap = previous && previous.lessonNumber !== lesson.lessonNumber ? gapMinutes(previous, lesson) : 0;
        return (
          <Fragment key={`${lesson.lessonNumber}-${lesson.subject}-${lesson.subgroup}`}>
            {gap >= 40 && <div className="gap">окно {formatGap(gap)}</div>}
            <LessonCard
              lesson={lesson}
              live={lesson === next ? liveLabel(lesson, now) : undefined}
              past={isToday && minutesUntil(lesson.date, endTime(lesson), now) <= 0}
              homework={remoteHomework?.get(homeworkKey(lesson))?.text}
              onClick={() => onOpen(lesson)}
            />
          </Fragment>
        );
      })}
    </div>
  );
};

type ScheduleProps = {
  profile: LocalProfile;
  profileRevision: number;
  onChangeGroup: () => void;
  onOpenLesson: (lesson: Lesson) => void;
};

export const Schedule = ({ profile, profileRevision, onChangeGroup, onOpenLesson }: ScheduleProps) => {
  const now = useMemo(() => irkutskNow(), []);
  const todayKey = toDateKey(now);
  const [mode, setMode] = useState<Mode>('day');
  const [selected, setSelected] = useState(todayKey);

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
  const shiftWeek = (weeks: number) => {
    const target = toDateKey(addDays(fromDateKey(weekStart), weeks * 7));
    const sameWeekday = toDateKey(addDays(fromDateKey(target), (fromDateKey(selected).getUTCDay() + 6) % 7));
    setSelected(target === toDateKey(startOfWeek(now)) ? todayKey : sameWeekday);
  };
  const canShift = (weeks: number) => availableWeeks.includes(toDateKey(addDays(fromDateKey(weekStart), weeks * 7)));

  return (
    <div className="screen">
      <div className="header">
        <div className="header__group">
          <Typography.Headline>{profile.group.title}</Typography.Headline>
          <Typography.Label className="muted">
            {profile.subgroup ? `${profile.subgroup} подгруппа` : 'вся группа'}
          </Typography.Label>
        </div>
        <button type="button" className="chip-button" onClick={onChangeGroup}>Сменить</button>
      </div>

      <div className="segmented" role="tablist">
        {(['day', 'week'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}>
            {value === 'day' ? 'День' : 'Неделя'}
          </button>
        ))}
      </div>

      <div className="week-nav">
        <button type="button" className="icon-button" aria-label="Предыдущая неделя" disabled={!canShift(-1)} onClick={() => shiftWeek(-1)}>‹</button>
        <Typography.Label className="muted">
          {formatShortDay(fromDateKey(days[0]))} — {formatShortDay(fromDateKey(days[6]))}
          {week.status === 'ready' && ` · ${week.data.weekEven ? 'чётная' : 'нечётная'}`}
        </Typography.Label>
        <button type="button" className="icon-button" aria-label="Следующая неделя" disabled={!canShift(1)} onClick={() => shiftWeek(1)}>›</button>
      </div>

      {mode === 'day' && (
        <div className="days">
          {days.map((key, index) => {
            const classes = [
              'day',
              key === todayKey && 'day--today',
              key === selected && 'day--selected',
              lessons.some((lesson) => lesson.date === key) && 'day--has-lessons',
            ];
            return (
              <button
                key={key}
                type="button"
                className={classes.filter(Boolean).join(' ')}
                aria-pressed={key === selected}
                onClick={() => setSelected(key)}
              >
                <span className="day__weekday">{WEEKDAYS[index]}</span>
                <span className="day__number">{fromDateKey(key).getUTCDate()}</span>
                <span className="day__dot" />
              </button>
            );
          })}
        </div>
      )}

      {week.status === 'loading' && <Loading />}
      {week.status === 'error' && <ErrorState message={week.message} onRetry={retry} />}

      {week.status === 'ready' && mode === 'day' && (
        <div className="stack">
          <span className="section-title">
            {selected === todayKey ? 'Сегодня, ' : selected === toDateKey(addDays(now, 1)) ? 'Завтра, ' : ''}
            {formatDay(fromDateKey(selected))}
          </span>
          <DayLessons lessons={lessons} dateKey={selected} now={now} remoteHomework={remoteHomework} onOpen={onOpenLesson} />
        </div>
      )}

      {week.status === 'ready' && mode === 'week' && (
        lessons.length === 0
          ? <Empty icon="🏖️">На этой неделе пар нет</Empty>
          : days
            .filter((key) => lessons.some((lesson) => lesson.date === key))
            .map((key) => (
              <section key={key} className="stack">
                <span className="section-title">{formatDay(fromDateKey(key))}</span>
                <DayLessons lessons={lessons} dateKey={key} now={now} remoteHomework={remoteHomework} onOpen={onOpenLesson} />
              </section>
            ))
      )}

      {meta.status === 'ready' && (
        <span className="footnote">
          Расписание ИРНИТУ · обновлено {formatUpdatedAt(meta.data.updatedAt)}
        </span>
      )}
    </div>
  );
};
