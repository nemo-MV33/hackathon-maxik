import { useMemo, useState } from 'react';
import { Button, Typography } from '@maxhub/max-ui';
import { loadMeta, loadWeek, type Lesson } from '../data/schedule';
import {
  addDays, formatDay, formatShortDay, formatUpdatedAt, fromDateKey, irkutskNow, minutesUntil, startOfWeek, toDateKey,
} from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { LessonCard } from '../components/LessonCard';
import { homeworkId, useHomework } from '../lib/homework';
import { homeworkKey, useRemoteHomework, type HomeworkItem } from '../data/homework';
import { Empty, ErrorState, Loading } from '../components/Status';

type Mode = 'today' | 'tomorrow' | 'week';

const forSubgroup = (lessons: Lesson[], subgroup: 1 | 2 | null) =>
  lessons.filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup);

const liveLabel = (lesson: Lesson, now: Date) => {
  const untilStart = minutesUntil(lesson.date, lesson.time, now);
  const untilEnd = minutesUntil(lesson.date, lesson.time.slice(6), now);
  if (untilStart <= 0 && untilEnd > 0) return `Идёт сейчас · ещё ${untilEnd} мин`;
  if (untilStart > 0 && untilStart <= 120) return `Через ${untilStart} мин`;
  return undefined;
};

type DayProps = {
  lessons: Lesson[];
  dateKey: string;
  now: Date;
  groupId: number;
  remoteHomework: Map<string, HomeworkItem> | null | undefined;
  onOpen: (lesson: Lesson) => void;
};

const DayLessons = ({ lessons, dateKey, now, groupId, remoteHomework, onOpen }: DayProps) => {
  const localHomework = useHomework();
  const day = lessons.filter((lesson) => lesson.date === dateKey);
  if (day.length === 0) return <Empty>Пар нет — можно отдохнуть</Empty>;
  const isToday = dateKey === toDateKey(now);
  const next = isToday ? day.find((lesson) => minutesUntil(lesson.date, lesson.time.slice(6), now) > 0) : undefined;
  return (
    <div className="stack">
      {day.map((lesson) => (
        <LessonCard
          key={`${lesson.lessonNumber}-${lesson.subject}-${lesson.subgroup}`}
          lesson={lesson}
          highlight={lesson === next ? liveLabel(lesson, now) : undefined}
          homework={remoteHomework === undefined
            ? localHomework[homeworkId(groupId, lesson)]?.text
            : remoteHomework?.get(homeworkKey(lesson))?.text}
          onClick={() => onOpen(lesson)}
        />
      ))}
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
  const [mode, setMode] = useState<Mode>('today');
  const now = useMemo(() => irkutskNow(), []);
  const [weekOffset, setWeekOffset] = useState(0);

  const targetDate = mode === 'tomorrow' ? addDays(now, 1) : now;
  const weekStart = toDateKey(addDays(startOfWeek(targetDate), mode === 'week' ? weekOffset * 7 : 0));

  const [meta] = useAsync(loadMeta, []);
  const [week, retry] = useAsync(() => loadWeek(profile.group.id, weekStart), [profile.group.id, weekStart]);
  const weekEnd = toDateKey(addDays(fromDateKey(weekStart), 6));
  const [homework] = useRemoteHomework(profile.group.id, weekStart, weekEnd, profileRevision);
  const remoteHomework = homework.status === 'disabled'
    ? undefined
    : homework.status === 'ready'
      ? new Map(homework.data.items.map((item) => [`${item.date}:${item.lessonNumber}:${item.subgroup ?? 0}`, item]))
      : null;

  const availableWeeks = meta.status === 'ready' ? meta.data.weeks : [];
  const lessons = week.status === 'ready' ? forSubgroup(week.data.lessons, profile.subgroup) : [];

  return (
    <div className="screen">
      <div className="header">
        <div>
          <Typography.Headline>{profile.group.title}</Typography.Headline>
          <Typography.Label className="muted">
            {profile.subgroup ? `${profile.subgroup} подгруппа` : 'вся группа'}
          </Typography.Label>
        </div>
        <Button size="small" variant="secondary" onClick={onChangeGroup}>Сменить</Button>
      </div>

      <div className="tabs" role="tablist">
        {(['today', 'tomorrow', 'week'] as const).map((value) => (
          <Button
            key={value}
            size="small"
            role="tab"
            aria-selected={mode === value}
            variant={mode === value ? 'primary' : 'secondary'}
            onClick={() => { setMode(value); setWeekOffset(0); }}
          >
            {{ today: 'Сегодня', tomorrow: 'Завтра', week: 'Неделя' }[value]}
          </Button>
        ))}
      </div>

      {mode === 'week' && (
        <div className="week-nav">
          <Button size="small" variant="ghost" disabled={weekOffset <= 0} onClick={() => setWeekOffset(weekOffset - 1)}>←</Button>
          <Typography.Label>
            {formatShortDay(fromDateKey(weekStart))} — {formatShortDay(addDays(fromDateKey(weekStart), 6))}
            {week.status === 'ready' && ` · ${week.data.weekEven ? 'чётная' : 'нечётная'}`}
          </Typography.Label>
          <Button
            size="small"
            variant="ghost"
            disabled={!availableWeeks.includes(toDateKey(addDays(fromDateKey(weekStart), 7)))}
            onClick={() => setWeekOffset(weekOffset + 1)}
          >→</Button>
        </div>
      )}

      {mode !== 'week' && <Typography.Title className="day-title">{formatDay(targetDate)}</Typography.Title>}

      {week.status === 'loading' && <Loading />}
      {week.status === 'error' && <ErrorState message={week.message} onRetry={retry} />}
      {week.status === 'ready' && mode !== 'week' && (
        <DayLessons lessons={lessons} dateKey={toDateKey(targetDate)} now={now} groupId={profile.group.id} remoteHomework={remoteHomework} onOpen={onOpenLesson} />
      )}
      {week.status === 'ready' && mode === 'week' && (
        lessons.length === 0
          ? <Empty>На этой неделе пар нет</Empty>
          : Array.from({ length: 7 }, (_, index) => addDays(fromDateKey(weekStart), index))
            .filter((day) => lessons.some((lesson) => lesson.date === toDateKey(day)))
            .map((day) => (
              <section key={toDateKey(day)} className="stack">
                <Typography.Title className="day-title">{formatDay(day)}</Typography.Title>
                <DayLessons lessons={lessons} dateKey={toDateKey(day)} now={now} groupId={profile.group.id} remoteHomework={remoteHomework} onOpen={onOpenLesson} />
              </section>
            ))
      )}

      {meta.status === 'ready' && (
        <Typography.Label className="muted footnote">
          Источник: расписание ИРНИТУ · обновлено {formatUpdatedAt(meta.data.updatedAt)}
        </Typography.Label>
      )}
    </div>
  );
};
