import { HomeworkCompletion } from './HomeworkCompletion';
import type { Lesson } from '../data/schedule';
import type { HomeworkItem } from '../data/homework';
import type { Announcement } from '../lib/api';
import { formatMoment, formatShortDay } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { BellIcon, ChevronRight, MegaphoneIcon, PaperclipIcon } from './Icon';

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
// Карточка короткая: срок в чипе, вложения счётчиком; подробности — на экране ДЗ.
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
      {tasks.map((task) => {
        if (task.kind === 'announcement') {
          return (
            <li key={task.key}>
              <button type="button" className="task task--announcement" onClick={() => onOpenAnnouncement?.(task.item)}>
                <span className="task__top">
                  {showDate && <span className="task__when">{when(task.date)}</span>}
                  <span className="task__tag task__tag--accent"><MegaphoneIcon size={14} />{t.announcementTag}</span>
                  {task.item.myRemindAt && <span className="task__bell"><BellIcon size={13} />{formatMoment(task.item.myRemindAt)}</span>}
                </span>
                <span className="task__text">{task.item.text}</span>
                <ChevronRight size={18} className="task__chevron" />
              </button>
            </li>
          );
        }
        const { item } = task;
        const files = item.attachments?.length ?? 0;
        const overdue = !item.completed && item.dueAt && Date.parse(item.dueAt) < Date.now();
        const classes = ['task-card', item.completed && 'is-complete', item.source === 'personal' && 'task-card--personal', item.completionRevision && 'has-check'];
        return (
          <li key={task.key} className={classes.filter(Boolean).join(' ')}>
            <HomeworkCompletion item={item} compact />
            <button type="button" className="task" onClick={() => onOpenHomework(task)}>
              <span className="task__top">
                {showDate && <span className={`task__when${dayDiff(task.date, todayKey) <= 1 ? ' is-soon' : ''}`}>{when(task.date)}</span>}
                <span className="task__time">{task.time}</span>
                {overdue && <span className="task__when is-late">{t.overdue}</span>}
                <span className="task__tag">{item.source === 'personal' ? t.homeworkMine : t.homeworkShort}</span>
              </span>
              <span className="task__title">{item.subject}</span>
              {item.text && <span className="task__text">{item.text}</span>}
              {(files > 0 || item.remindAt) && (
                <span className="task__meta">
                  {files > 0 && <span><PaperclipIcon size={14} />{t.filesCount(files)}</span>}
                  {item.remindAt && <span><BellIcon size={14} />{formatMoment(item.remindAt)}</span>}
                </span>
              )}
              <ChevronRight size={18} className="task__chevron" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};
