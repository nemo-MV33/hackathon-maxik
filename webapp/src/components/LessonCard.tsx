import { Typography } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';

type Props = { lesson: Lesson; highlight?: string; homework?: string; onClick?: () => void };

export const LessonCard = ({ lesson, highlight, homework, onClick }: Props) => (
  <button type="button" className={`lesson${highlight ? ' lesson--active' : ''}`} onClick={onClick}>
    <div className="lesson__time">
      <Typography.Label>{lesson.time.slice(0, 5)}</Typography.Label>
      <Typography.Label className="muted">{lesson.time.slice(6)}</Typography.Label>
    </div>
    <div className="lesson__body">
      {highlight && <Typography.Label className="lesson__badge">{highlight}</Typography.Label>}
      <Typography.Body className="lesson__subject">{lesson.subject}</Typography.Body>
      <Typography.Label className="muted">
        {[
          lesson.lessonType,
          lesson.subgroup && `${lesson.subgroup} подгр.`,
          lesson.transferred && 'перенос',
        ].filter(Boolean).join(' · ')}
      </Typography.Label>
      {(lesson.auditories.length > 0 || lesson.teachers.length > 0) && (
        <Typography.Label className="muted">
          {[lesson.auditories.join(', '), lesson.teachers.join(', ')].filter(Boolean).join(' · ')}
        </Typography.Label>
      )}
      {homework && <Typography.Label className="lesson__homework">📚 {homework}</Typography.Label>}
    </div>
  </button>
);
