import { useState } from 'react';
import { Button, Typography } from '@maxhub/max-ui';
import { loadWeek, loadGroups, type Group } from '../data/schedule';
import { saveHomework } from '../data/homework';
import { haptic } from '../bridge/max';
import { syncProfile } from '../lib/api';
import { type SharedHomework } from '../lib/homework';
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
  onDone: (group?: Group) => void;
}) => {
  const [context, retry] = useAsync(() => (shared ? findContext(shared) : Promise.resolve(null)), [shared]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!shared) {
    return (
      <div className="screen">
        <ErrorState message="Ссылка с ДЗ повреждена или устарела. Попроси прислать её ещё раз" />
        <Button stretched onClick={() => onDone()}>Открыть расписание</Button>
      </div>
    );
  }
  if (context.status === 'loading') return <Loading />;
  if (context.status === 'error') return <ErrorState message={context.message} onRetry={retry} />;

  const { group, lesson } = context.data ?? {};
  const subject = lesson?.subject ?? `${shared.lessonNumber} пара`;
  const otherGroup = profile && profile.group.id !== shared.groupId;

  const accept = async () => {
    if (!group || !lesson || saving) return;
    setSaving(true);
    setSaveError(null);
    let switched = false;
    try {
      await syncProfile(group.id, shared.subgroup);
      switched = true;
      await saveHomework(lesson, shared.text, 'personal');
      haptic.success();
      onDone(group);
    } catch (error) {
      if (switched && profile) {
        await syncProfile(profile.group.id, profile.subgroup).catch(() => {});
      }
      setSaveError((error as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <div className="hero">
        <span className="hero__logo">📬</span>
        <Typography.Headline>Одногруппник поделился ДЗ</Typography.Headline>
      </div>
      <div className="card">
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
      {!lesson && <Typography.Label className="error-text">Пара не найдена в расписании ИРНИТУ, сохранить ДЗ нельзя</Typography.Label>}
      {saveError && <Typography.Label className="error-text">{saveError}</Typography.Label>}
      <Button stretched disabled={!group || !lesson || saving} onClick={accept}>
        {saving ? 'Сохраняем…' : 'Сохранить себе'}
      </Button>
      <Button stretched variant="ghost" onClick={() => onDone()}>Не сохранять</Button>
    </div>
  );
};
