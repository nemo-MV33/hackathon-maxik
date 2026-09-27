import { useEffect, useState } from 'react';
import type { Lesson } from '../data/schedule';
import { useRemoteHomework } from '../data/homework';
import { addDays, formatDay, fromDateKey, timeToMinutes, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { loadLessons } from '../lib/lessons';
import { loadAnnouncements, type Announcement } from '../lib/api';
import { buildTasks, lessonFromHomework } from '../lib/tasks';
import { daysBetween, useUpcomingExams } from '../lib/exams';
import { lessonKindName } from '../lib/lessonKind';
import { DayTimeline, lessonEnd, lessonStart } from '../components/Timeline';
import { Empty, ErrorState, ScheduleSkeleton } from '../components/Status';
import { TopBar } from '../components/TopBar';
import { TaskList } from '../components/TaskList';
import { AnnouncementSheet } from '../components/AnnouncementSheet';
import { AbsenceSheet } from '../components/AbsenceSheet';
import { ChevronRight } from '../components/Icon';
import type { AbsenceKind } from '../lib/api';

const LOOKAHEAD_DAYS = 21;
const TASK_DAYS = 14;

type Props = {
  profile: LocalProfile;
  profileRevision: number;
  onOpenLesson: (lesson: Lesson) => void;
  onOpenProfile: () => void;
  onOpenExams: () => void;
  onOpenPlanner: () => void;
};

// Главная: что у меня сейчас. Если сегодня ещё есть пары — весь день; если нет — ближайшая пара.
// Ниже — задачи: ДЗ и объявления от ближайшего к дальнему.
export const HomeScreen = ({ profile, profileRevision, onOpenLesson, onOpenProfile, onOpenExams, onOpenPlanner }: Props) => {
  const { t } = useI18n();
  const now = useNow();
  const todayKey = toDateKey(now);
  const lastKey = toDateKey(addDays(now, LOOKAHEAD_DAYS));
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [lessons, retry] = useAsync(() => loadLessons(profile.group.id, profile.subgroup, todayKey, lastKey), [profile.group.id, profile.subgroup, todayKey]);
  const [homework] = useRemoteHomework(profile.group.id, todayKey, toDateKey(addDays(now, TASK_DAYS)), profileRevision);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const [absence, setAbsence] = useState<{ kind: AbsenceKind; lesson: Lesson } | null>(null);
  const exams = useUpcomingExams(profile.group.id, profile.subgroup, todayKey);

  useEffect(() => {
    let active = true;
    loadAnnouncements().then((data) => active && setAnnouncements(data.items)).catch(() => {});
    return () => { active = false; };
  }, [profileRevision]);

  const all = lessons.status === 'ready' ? lessons.data : [];
  const today = all.filter((lesson) => lesson.date === todayKey);
  const todayActive = today.some((lesson) => timeToMinutes(lessonEnd(lesson)) > nowMinutes);
  const upcoming = all.find((lesson) => lesson.date > todayKey);
  const focusDay = todayActive ? todayKey : upcoming?.date;
  const focusLessons = todayActive
    ? today
    : all.filter((lesson) => lesson.date === upcoming?.date && lesson.lessonNumber === upcoming?.lessonNumber);
  const diff = focusDay ? daysBetween(todayKey, focusDay) : 0;
  const label = diff === 0 ? t.today : diff === 1 ? t.tomorrow : diff === 2 ? t.dayAfterTomorrow : null;
  const homeworkMap = homework.status === 'ready'
    ? new Map(homework.data.items.map((item) => [`${item.date}:${item.lessonNumber}:${item.subgroup ?? 0}`, item]))
    : null;
  const tasks = homework.status === 'ready' ? buildTasks(homework.data.items, announcements, all, todayKey) : [];

  return (
    <div className="screen screen--tabbed screen--home">
      <TopBar
        onOpenProfile={onOpenProfile}
        left={<span className="topbar__date first-letter">{formatDay(fromDateKey(todayKey))}</span>}
      />

      {exams.length > 0 && (
        <button type="button" className="exam-banner" onClick={onOpenExams}>
          <span className="exam-banner__title">{t.examsSoon(exams.length)}</span>
          <span className="exam-banner__next">
            {t.examsNext(lessonKindName(exams[0].lessonType), exams[0].subject, t.daysLeft(daysBetween(todayKey, exams[0].date)))}
          </span>
          <ChevronRight size={18} />
        </button>
      )}

      <section className="home-block" aria-labelledby="home-schedule">
        <div className="block-head">
          <h2 id="home-schedule" className="block-title">{label ?? t.nextClass}</h2>
          {focusDay && lessons.status === 'ready' && (
            <span className="block-note first-letter">
              {formatDay(fromDateKey(focusDay))}
              {todayActive ? ` · ${t.pairs(new Set(today.map((lesson) => lesson.lessonNumber)).size)} · ${lessonStart(today[0])}–${lessonEnd(today[today.length - 1])}` : ''}
            </span>
          )}
        </div>
        {lessons.status === 'loading' && <ScheduleSkeleton rows={2} />}
        {lessons.status === 'error' && <ErrorState message={lessons.message} onRetry={retry} />}
        {lessons.status === 'ready' && !focusDay && <Empty title={t.noUpcomingTitle}>{t.noUpcomingText}</Empty>}
        {lessons.status === 'ready' && focusDay && (
          <DayTimeline
            lessons={focusLessons}
            dateKey={focusDay}
            todayKey={todayKey}
            now={now}
            homework={homeworkMap}
            onOpen={onOpenLesson}
            onAbsence={todayActive ? (kind, lesson) => setAbsence({ kind, lesson }) : undefined}
          />
        )}
      </section>

      <section className="home-block" aria-labelledby="home-tasks">
        <div className="block-head block-head--row">
          <h2 id="home-tasks" className="block-title">{t.tasks}</h2>
          <button type="button" className="text-button" onClick={onOpenPlanner}>{t.openPlannerLink}</button>
        </div>
        {homework.status === 'loading' && <ScheduleSkeleton rows={1} />}
        {homework.status === 'error' && <p className="callout">{homework.message}</p>}
        {homework.status === 'ready' && tasks.length === 0 && <Empty title={t.noTasksTitle}>{t.noTasksText}</Empty>}
        {tasks.length > 0 && (
          <TaskList
            tasks={tasks}
            todayKey={todayKey}
            onOpenHomework={(task) => onOpenLesson(task.lesson ?? lessonFromHomework(task.item))}
            onOpenAnnouncement={setOpenAnnouncement}
          />
        )}
      </section>

      {openAnnouncement && (
        <AnnouncementSheet
          item={openAnnouncement}
          now={now}
          onClose={() => setOpenAnnouncement(null)}
          onSaved={(saved) => setAnnouncements((items) => items.map((item) => (item.id === saved.id ? saved : item)))}
        />
      )}
      {absence && <AbsenceSheet kind={absence.kind} lesson={absence.lesson} onClose={() => setAbsence(null)} />}
    </div>
  );
};
