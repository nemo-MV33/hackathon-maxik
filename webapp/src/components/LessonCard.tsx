import type { Lesson } from '../data/schedule';
import { lessonKindClass } from '../lib/lessonKind';

type Props = {
  lesson: Lesson;
  live?: string;
  past?: boolean;
  homework?: string;
  onClick?: () => void;
};

export const LessonCard = ({ lesson, live, past, homework, onClick }: Props) => {
  const place = [lesson.auditories.join(', '), lesson.teachers.join(', ')].filter(Boolean).join(' · ');
  const classes = ['lesson', lessonKindClass(lesson.lessonType), live && 'lesson--active', past && 'lesson--past'];
  return (
    <button type="button" className={classes.filter(Boolean).join(' ')} onClick={onClick}>
      <div className="lesson__time">
        <span className="lesson__start">{lesson.time.slice(0, 5)}</span>
        <span className="lesson__end">{lesson.time.slice(6)}</span>
      </div>
      <div className="lesson__body">
        {live && <span className="lesson__live">{live}</span>}
        <span className="lesson__subject">{lesson.subject}</span>
        <div className="tags">
          <span className="tag">{lesson.lessonType}</span>
          {lesson.subgroup && <span className="tag tag--neutral">{lesson.subgroup} подгруппа</span>}
          {lesson.transferred && <span className="tag tag--neutral">перенос</span>}
        </div>
        {place && <span className="lesson__meta">{place}</span>}
        {homework && <span className="lesson__homework">📚 {homework}</span>}
      </div>
    </button>
  );
};
