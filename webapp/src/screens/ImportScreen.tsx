import { Button, Typography } from '@maxhub/max-ui';
import { loadWeek, loadGroups } from '../data/schedule';
import { haptic } from '../bridge/max';
import { homeworkId, saveHomework, useHomework, type SharedHomework } from '../lib/homework';
import { formatDay, fromDateKey, startOfWeek, toDateKey } from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { ErrorState, Loading } from '../components/Status';

const findContext = async (shared: SharedHomework) => {
  const [groups, week] = await Promise.all([
    loadGroups(),
    loadWeek(shared.groupId, toDateKey(startOfWeek(fromDateKey(shared.date)))).catch(() => null),
  ]);
  const group = groups.find((item) => item.id === shared.groupId);
  const lesson = week?.lessons.find((item) =>
    item.date === shared.date && item.lessonNumber === shared.lessonNumber
    && (item.subgroup ?? null) === shared.subgroup);
  return { group, lesson };
};

export const ImportScreen = ({ shared, profile, onDone }: {
  shared: SharedHomework | null;
  profile: LocalProfile | null;
  onDone: () => void;
}) => {
  const [context, retry] = useAsync(() => (shared ? findContext(shared) : Promise.resolve(null)), [shared]);
  const items = useHomework();

  if (!shared) {
    return (
      <div className="screen">
        <ErrorState message="Ссылка с ДЗ повреждена или устарела. Попроси прислать её ещё раз" />
        <Button stretched onClick={onDone}>Открыть расписание</Button>
      </div>
    );
  }
  if (context.status === 'loading') return <Loading />;
  if (context.status === 'error') return <ErrorState message={context.message} onRetry={retry} />;

  const { group, lesson } = context.data ?? {};
  const subject = lesson?.subject ?? `${shared.lessonNumber} пара`;
  const existing = items[homeworkId(shared.groupId, shared)];
  const otherGroup = profile && profile.group.id !== shared.groupId;

  const accept = () => {
    saveHomework({ ...shared, subject, updatedAt: new Date().toISOString(), sharedBy: 'import' });
    haptic.success();
    onDone();
  };

  return (
    <div className="screen">
      <Typography.Headline>Одногруппник поделился ДЗ</Typography.Headline>
      <div className="homework stack">
        <Typography.Body className="lesson__subject">{subject}</Typography.Body>
        <Typography.Label className="muted first-letter">
          {group?.title ?? 'Группа'} · {formatDay(fromDateKey(shared.date))}{lesson ? ` · ${lesson.time.slice(0, 5)}` : ''}
        </Typography.Label>
        <Typography.Body className="homework__text">{shared.text}</Typography.Body>
      </div>
      {otherGroup && (
        <Typography.Label className="error-text">
          Это ДЗ для группы {group?.title}, а у тебя выбрана {profile.group.title}
        </Typography.Label>
      )}
      {existing && existing.text !== shared.text && (
        <Typography.Label className="muted">У тебя уже записано: «{existing.text}». Сохранение заменит его</Typography.Label>
      )}
      <Button stretched onClick={accept}>
        {existing?.text === shared.text ? 'Уже сохранено — открыть расписание' : 'Сохранить себе'}
      </Button>
      <Button stretched variant="ghost" onClick={onDone}>Не сохранять</Button>
    </div>
  );
};
