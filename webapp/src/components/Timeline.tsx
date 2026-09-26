import { Fragment } from 'react';
import type { Lesson } from '../data/schedule';
import { homeworkKey, type HomeworkItem } from '../data/homework';
import { clockLabel, formatDuration, timeToMinutes } from '../lib/date';
import { isControlLesson, lessonKindClass, lessonKindName } from '../lib/lessonKind';
import { useI18n } from '../lib/i18n';

export const lessonStart = (lesson: Lesson) => lesson.time.slice(0, 5);
export const lessonEnd = (lesson: Lesson) => lesson.time.slice(6, 11);

type CardProps = {
  lesson: Lesson;
  state: 'past' | 'live' | 'idle';
  nowMinutes: number;
  homework?: HomeworkItem;
  onOpen: (lesson: Lesson) => void;
};

const LessonCard = ({ lesson, state, nowMinutes, homework, onOpen }: CardProps) => {
  const { t } = useI18n();
  const start = timeToMinutes(lessonStart(lesson));
  const end = timeToMinutes(lessonEnd(lesson));
  const progress = state === 'live' ? Math.min(100, Math.max(0, ((nowMinutes - start) / (end - start)) * 100)) : 0;
  const kind = [lessonKindName(lesson.lessonType), lesson.auditories[0]].filter(Boolean).join(' · ');
  const meta = [
    lesson.teachers.join(', '),
    lesson.subgroup ? t.subgroup(lesson.subgroup) : '',
    lesson.auditories.length > 1 ? lesson.auditories.slice(1).join(', ') : '',
  ].filter(Boolean).join(' · ');
  const classes = [
    'card',
    lessonKindClass(lesson.lessonType),
    `card--${state}`,
    isControlLesson(lesson.lessonType) && 'card--control',
  ];
  return (
    <button type="button" className={classes.filter(Boolean).join(' ')} onClick={() => onOpen(lesson)}>
      <span className="card__row">
        <span className="card__time">
          {lessonStart(lesson)}
          <small>– {lessonEnd(lesson)}</small>
        </span>
        <span className="card__kind">{kind}</span>
      </span>
      <span className="card__subject">
        {lesson.transferred && <span className="flag">{t.transferred}</span>}
        {lesson.subject}
      </span>
      {meta && <span className="card__meta">{meta}</span>}
      {state === 'live' && (
        <span className="card__live">
          {t.live(formatDuration(end - nowMinutes))}
          <span className="meter" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
        </span>
      )}
      {homework?.text && (
        <span className="card__hw">
          <span className="card__hw-label">{homework.source === 'personal' ? t.homeworkMine : t.homeworkShort}</span>
          <span className="card__hw-text">{homework.text}</span>
        </span>
      )}
    </button>
  );
};

const NowMarker = ({ now, note }: { now: Date; note: string }) => (
  <div className="now-marker" role="note">
    <span className="now-marker__time">{clockLabel(now)}</span>
    <span className="now-marker__note">{note}</span>
  </div>
);

type DayTimelineProps = {
  lessons: Lesson[];
  dateKey: string;
  todayKey: string;
  now: Date;
  homework: Map<string, HomeworkItem> | null;
  onOpen: (lesson: Lesson) => void;
};

export const DayTimeline = ({ lessons, dateKey, todayKey, now, homework, onOpen }: DayTimelineProps) => {
  const { t } = useI18n();
  const isToday = dateKey === todayKey;
  const isPastDay = dateKey < todayKey;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const upcomingIndex = isToday ? lessons.findIndex((lesson) => timeToMinutes(lessonStart(lesson)) > nowMinutes) : -1;
  const hasLive = isToday && lessons.some((lesson) =>
    timeToMinutes(lessonStart(lesson)) <= nowMinutes && timeToMinutes(lessonEnd(lesson)) > nowMinutes);
  const showMarker = isToday && !hasLive;

  const stateOf = (lesson: Lesson): CardProps['state'] => {
    if (isPastDay) return 'past';
    if (!isToday) return 'idle';
    if (timeToMinutes(lessonEnd(lesson)) <= nowMinutes) return 'past';
    if (timeToMinutes(lessonStart(lesson)) <= nowMinutes) return 'live';
    return 'idle';
  };

  const markerNote = (index: number) => {
    const left = formatDuration(timeToMinutes(lessonStart(lessons[index])) - nowMinutes);
    return index === 0 ? t.untilFirst(left) : t.breakUntil(left);
  };

  return (
    <div className="cards">
      {lessons.map((lesson, index) => {
        const previous = lessons[index - 1];
        const gap = previous && previous.lessonNumber !== lesson.lessonNumber
          ? timeToMinutes(lessonStart(lesson)) - timeToMinutes(lessonEnd(previous))
          : 0;
        const markerHere = showMarker && index === upcomingIndex;
        return (
          <Fragment key={`${lesson.lessonNumber}-${lesson.subgroup ?? 0}-${lesson.subject}`}>
            {markerHere && <NowMarker now={now} note={markerNote(index)} />}
            {!markerHere && gap >= 40 && <p className="gap-note">{t.gap(formatDuration(gap))}</p>}
            <LessonCard
              lesson={lesson}
              state={stateOf(lesson)}
              nowMinutes={nowMinutes}
              homework={homework?.get(homeworkKey(lesson))}
              onOpen={onOpen}
            />
          </Fragment>
        );
      })}
      {showMarker && upcomingIndex === -1 && <NowMarker now={now} note={t.dayOver} />}
    </div>
  );
};
