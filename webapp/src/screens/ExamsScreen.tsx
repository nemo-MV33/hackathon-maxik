import type { Lesson } from '../data/schedule';
import { hasNativeBackButton } from '../bridge/max';
import { formatDay, fromDateKey, toDateKey } from '../lib/date';
import { daysBetween, loadExams } from '../lib/exams';
import { isControlLesson, lessonKindClass, lessonKindName } from '../lib/lessonKind';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useBackButton } from '../lib/useBackButton';
import { useNow } from '../lib/useNow';
import { useI18n } from '../lib/i18n';
import { ChevronLeft } from '../components/Icon';
import { Empty, ErrorState, ScheduleSkeleton } from '../components/Status';

type Props = { profile: LocalProfile; onBack: () => void; onOpenLesson: (lesson: Lesson) => void };

export const ExamsScreen = ({ profile, onBack, onOpenLesson }: Props) => {
  const { t } = useI18n();
  const todayKey = toDateKey(useNow());
  useBackButton(onBack);
  const [exams, retry] = useAsync(() => loadExams(profile.group.id, profile.subgroup, todayKey), [profile.group.id, profile.subgroup]);

  return (
    <div className="screen screen--exams">
      {!hasNativeBackButton() && (
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={18} />{t.scheduleBack}</button>
      )}
      <h1 className="display">{t.examsTitle}</h1>
      {exams.status === 'loading' && <ScheduleSkeleton rows={3} />}
      {exams.status === 'error' && <ErrorState message={exams.message} onRetry={retry} />}
      {exams.status === 'ready' && exams.data.length === 0 && <Empty title={t.examsTitle}>{t.examsEmpty}</Empty>}
      {exams.status === 'ready' && exams.data.length > 0 && (
        <div className="cards">
          {exams.data.map((lesson) => (
            <button
              key={`${lesson.date}-${lesson.lessonNumber}-${lesson.subject}`}
              type="button"
              className={`card ${lessonKindClass(lesson.lessonType)}${isControlLesson(lesson.lessonType) ? ' card--control' : ''}`}
              onClick={() => onOpenLesson(lesson)}
            >
              <span className="card__row">
                <span className="card__time first-letter">{formatDay(fromDateKey(lesson.date))}</span>
                <span className="card__kind">{t.daysLeft(daysBetween(todayKey, lesson.date))}</span>
              </span>
              <span className="card__subject">{lesson.subject}</span>
              <span className="card__meta">
                {[lessonKindName(lesson.lessonType), lesson.time.slice(0, 5), lesson.auditories.join(', ')].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
