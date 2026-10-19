import { lessonMoment, userTimeZone, lessonTime } from '../lib/timezone';
import { Fragment } from 'react';
import type { Lesson } from '../data/schedule';
import { homeworkKey, type HomeworkItem } from '../data/homework';
import { clockLabel, formatDuration, formatStamp, timeToMinutes } from '../lib/date';
import { isControlLesson, lessonKindClass, lessonKindName } from '../lib/lessonKind';
import { useI18n } from '../lib/i18n';
import { groupTimeZone, universityClock } from '../lib/universities';
import type { AbsenceKind } from '../lib/api';

export const lessonStart = (lesson: Lesson) => lessonTime(lesson).slice(0, 5);
export const lessonEnd = (lesson: Lesson) => lessonTime(lesson).slice(6, 11);

type CardProps = {
  lesson: Lesson;
  state: 'past' | 'live' | 'idle';
  nowMinutes: number;
  homework?: HomeworkItem;
  onOpen: (lesson: Lesson) => void;
  metaKind: MetaKind;
};

// В расписании преподавателя важнее группы, в расписании группы — преподаватели.
export type MetaKind = 'group' | 'teacher' | 'auditory';

const LessonCard = ({ lesson, state, homework, onOpen, metaKind }: CardProps) => {
  const { t } = useI18n();
  const startsAt = Date.parse(lessonMoment(lesson));
  const endsAt = Date.parse(lessonMoment(lesson, true));
  const progress = state === 'live' ? Math.min(100, Math.max(0, (Date.now() - startsAt) / (endsAt - startsAt) * 100)) : 0;
  const kind = [lessonKindName(lesson.lessonType), lesson.auditories[0]].filter(Boolean).join(', ');
  const meta = [
    metaKind !== 'teacher' ? lesson.teachers.join(', ') : '',
    metaKind !== 'group' ? (lesson.groups ?? []).join(', ') : '',
    lesson.subgroup ? t.subgroup(lesson.subgroup) : '',
    lesson.auditories.length > 1 ? lesson.auditories.slice(1).join(', ') : '',
  ].filter(Boolean).join(', ');
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
      {userTimeZone() !== (lesson.timeZone || groupTimeZone(lesson.groupId)) && <span className="card__meta">{lesson.time.slice(0, 5)} {universityClock(lesson.groupId)}</span>}
      <span className="card__subject">
        {lesson.transferred && <span className="flag">{t.transferred}</span>}
        {lesson.subject}
      </span>
      {lesson.markedBy && lesson.markedAt && <span className="card__meta">{t.moveMarked(lesson.markedBy, formatStamp(lesson.markedAt))}</span>}
      {meta && <span className="card__meta">{meta}</span>}
      {state === 'live' && (
        <span className="card__live">
          {t.live(formatDuration(Math.max(0, Math.ceil((endsAt - Date.now()) / 60_000))))}
          <span className="meter" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
        </span>
      )}
      {(homework?.text || !!homework?.attachments?.length) && (
        <span className="card__hw">
          <span className="card__hw-label">{homework.source === 'personal' ? t.homeworkMine : t.homeworkShort}</span>
          <span className="card__hw-text">{homework?.text || `${t.attachmentsLabel}: ${homework?.attachments?.length ?? 0}`}</span>
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
  onAbsence?: (kind: AbsenceKind, lesson: Lesson) => void;
  metaKind?: MetaKind;
};

export const DayTimeline = ({ lessons, dateKey, todayKey, now, homework, onOpen, onAbsence, metaKind = 'group' }: DayTimelineProps) => {
  const { t } = useI18n();
  const isToday = dateKey === todayKey;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const upcomingIndex = isToday ? lessons.findIndex((lesson) => timeToMinutes(lessonStart(lesson)) > nowMinutes) : -1;
  const hasLive = isToday && lessons.some((lesson) =>
    Date.parse(lessonMoment(lesson)) <= Date.now() && Date.parse(lessonMoment(lesson, true)) > Date.now());
  const showMarker = isToday && !hasLive;

  const stateOf = (lesson: Lesson): CardProps['state'] => {
    if (Date.parse(lessonMoment(lesson, true)) <= Date.now()) return 'past';
    if (Date.parse(lessonMoment(lesson)) <= Date.now()) return 'live';
    return 'idle';
  };

  // «Опоздаю» имеет смысл только для пары, которая идёт или начнётся следующей.
  const absenceTarget = isToday && onAbsence
    ? lessons.find((lesson) => Date.parse(lessonMoment(lesson, true)) > Date.now())
    : undefined;

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
              metaKind={metaKind}
            />
            {lesson === absenceTarget && (
              <div className="absence-actions">
                <button type="button" className="pill-button" onClick={() => onAbsence!('late', lesson)}>{t.late}</button>
                <button type="button" className="pill-button" onClick={() => onAbsence!('absent', lesson)}>{t.absent}</button>
              </div>
            )}
          </Fragment>
        );
      })}
      {showMarker && upcomingIndex === -1 && <NowMarker now={now} note={t.dayOver} />}
    </div>
  );
};
