import type { Lesson } from '../data/schedule';
import type { HomeworkItem } from '../data/homework';
import type { Announcement } from '../lib/api';
import { formatMoment, formatShortDay } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { BellIcon, ChevronRight, MegaphoneIcon } from './Icon';

export type Task =
  | { kind: 'homework'; key: string; date: string; time: string; item: HomeworkItem; lesson?: Lesson }
  | { kind: 'announcement'; key: string; date: string; time: string; item: Announcement };

const dayDiff = (key: string, todayKey: string) =>
  Math.round((Date.parse(key) - Date.parse(todayKey)) / 86_400_000);

type Props = {
  tasks: Task[];
  todayKey: string;
  onOpenHomework: (task: Extract<Task, { kind: 'homework' }>) => void;
  onOpenAnnouncement?: (item: Announcement) => void;
  showDate?: boolean;
};

// Задачи — ДЗ к ближайшим парам и объявления старосты, от ближайшего к дальнему.
export const TaskList = ({ tasks, todayKey, onOpenHomework, onOpenAnnouncement, showDate = true }: Props) => {
  const { t } = useI18n();
  const when = (date: string) => {
    const diff = dayDiff(date, todayKey);
    if (diff === 0) return t.today;
    if (diff === 1) return t.tomorrow;
    return formatShortDay(date);
  };
  return (
    <ul className="tasks">
      {tasks.map((task) => (
        <li key={task.key}>
          {task.kind === 'homework' ? (
            <button type="button" className={`task${task.item.source === 'personal' ? ' task--personal' : ''}`} onClick={() => onOpenHomework(task)}>
              <span className="task__top">
                {showDate && <span className={`task__when${dayDiff(task.date, todayKey) <= 1 ? ' is-soon' : ''}`}>{when(task.date)}</span>}
                <span className="task__time">{task.time}</span>
                <span className="task__tag">{task.item.source === 'personal' ? t.homeworkMine : t.homeworkShort}</span>
                {task.item.remindAt && <span className="task__bell" aria-label={t.reminder}><BellIcon size={14} /></span>}
              </span>
              <span className="task__title">{task.item.subject}</span>
              <span className="task__text">{task.item.text}</span>
              <ChevronRight size={18} className="task__chevron" />
            </button>
          ) : (
            <button type="button" className="task task--announcement" onClick={() => onOpenAnnouncement?.(task.item)}>
              <span className="task__top">
                {showDate && <span className="task__when">{when(task.date)}</span>}
                <span className="task__tag task__tag--accent"><MegaphoneIcon size={13} /> {t.announcementTag}</span>
                {task.item.myRemindAt && <span className="task__bell"><BellIcon size={14} /> {formatMoment(task.item.myRemindAt)}</span>}
              </span>
              <span className="task__text task__text--full">{task.item.text}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};
