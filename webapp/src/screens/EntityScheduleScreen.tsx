import { useState } from 'react';
import type { Lesson } from '../data/schedule';
import { apiRequest } from '../lib/api';
import { addDays, formatRange, fromDateKey, startOfWeek, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { BackHeader } from '../components/BackHeader';
import { DayTimeline } from '../components/Timeline';
import { Empty, ErrorState, ScheduleSkeleton } from '../components/Status';
import { ChevronLeft, ChevronRight } from '../components/Icon';
import { DayHeading } from './Schedule';

export type EntityTarget = { kind: 'group' | 'teacher' | 'auditory'; id: number; title: string };

type Response = { weekEven: boolean; lessons: Lesson[] };

// Расписание найденного преподавателя, аудитории или чужой группы — по неделям, прямо из ИРНИТУ.
export const EntityScheduleScreen = ({ target, onBack }: { target: EntityTarget; onBack: () => void }) => {
  const { t } = useI18n();
  const now = useNow();
  const todayKey = toDateKey(now);
  const [weekStart, setWeekStart] = useState(() => toDateKey(startOfWeek(now)));
  const [week, retry] = useAsync(
    () => apiRequest<Response>(`/api/schedule/${target.kind}/${target.id}?week=${weekStart}`),
    [target.kind, target.id, weekStart],
  );
  const days = Array.from({ length: 7 }, (_, index) => toDateKey(addDays(fromDateKey(weekStart), index)));
  const lessons = week.status === 'ready' ? week.data.lessons : [];
  const busyDays = days.filter((key) => lessons.some((lesson) => lesson.date === key));
  const shift = (weeks: number) => setWeekStart(toDateKey(addDays(fromDateKey(weekStart), weeks * 7)));

  return (
    <div className="screen screen--entity">
      <BackHeader label={t.tabSchedule} onBack={onBack} eyebrow={t.searchKinds[target.kind]} title={target.title} />
      <div className="week-nav">
        <button type="button" className="icon-button" aria-label={t.previousWeek} onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <span className="week-nav__range">
          {formatRange(fromDateKey(days[0]), fromDateKey(days[6]))}
          {week.status === 'ready' && <span className="week-nav__parity"> · {week.data.weekEven ? t.even : t.odd}</span>}
        </span>
        <button type="button" className="icon-button" aria-label={t.nextWeek} onClick={() => shift(1)}><ChevronRight size={18} /></button>
      </div>
      {week.status === 'loading' && <ScheduleSkeleton rows={4} />}
      {week.status === 'error' && <ErrorState message={week.message} onRetry={retry} />}
      {week.status === 'ready' && busyDays.length === 0 && <Empty title={t.emptyWeekTitle}>{t.emptyWeekText}</Empty>}
      {week.status === 'ready' && busyDays.map((key) => {
        const dayLessons = lessons.filter((lesson) => lesson.date === key);
        return (
          <section key={key} className="week-day">
            <DayHeading dateKey={key} todayKey={todayKey} lessons={dayLessons} level="h2" />
            <DayTimeline lessons={dayLessons} dateKey={key} todayKey={todayKey} now={now} homework={null} onOpen={() => {}} metaKind={target.kind} />
          </section>
        );
      })}
    </div>
  );
};
