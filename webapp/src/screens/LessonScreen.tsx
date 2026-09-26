import { useEffect, useState } from 'react';
import { Button, Textarea, Typography } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { homeworkKey, saveHomework, useRemoteHomework } from '../data/homework';
import { haptic } from '../bridge/max';
import { formatDay, fromDateKey } from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useBackButton } from '../lib/useBackButton';
import { ErrorState, Loading } from '../components/Status';
import { lessonKindClass } from '../lib/lessonKind';

type Props = {
  lesson: Lesson;
  profile: LocalProfile;
  profileRevision: number;
  onBack: () => void;
};

const LessonHeading = ({ lesson, onBack }: Pick<Props, 'lesson' | 'onBack'>) => (
  <>
    <button type="button" className="chip-button back" onClick={onBack}>‹ Расписание</button>
    <div className={`card lesson-head ${lessonKindClass(lesson.lessonType)}`}>
      <div className="tags">
        <span className="tag">{lesson.lessonType}</span>
        {lesson.subgroup && <span className="tag tag--neutral">{lesson.subgroup} подгруппа</span>}
        {lesson.transferred && <span className="tag tag--neutral">перенос</span>}
      </div>
      <Typography.Headline>{lesson.subject}</Typography.Headline>
      <div className="info-row"><span>🗓</span><span className="first-letter">{formatDay(fromDateKey(lesson.date))}, {lesson.lessonNumber} пара · {lesson.time}</span></div>
      {lesson.auditories.length > 0 && <div className="info-row"><span>📍</span><span>{lesson.auditories.join(', ')}</span></div>}
      {lesson.teachers.length > 0 && <div className="info-row"><span>👤</span><span>{lesson.teachers.join(', ')}</span></div>}
      {lesson.comment && <div className="info-row"><span>💬</span><span>{lesson.comment}</span></div>}
    </div>
  </>
);

const RemoteLessonScreen = ({ lesson, profile, profileRevision, onBack }: Props) => {
  const [homework, refresh] = useRemoteHomework(profile.group.id, lesson.date, lesson.date, profileRevision);
  const item = homework.status === 'ready'
    ? homework.data.items.find((candidate) => homeworkKey(candidate) === homeworkKey(lesson))
    : undefined;
  const canEditShared = homework.status === 'ready' && homework.data.canEditShared;
  const [scope, setScope] = useState<'shared' | 'personal'>('personal');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (homework.status !== 'ready') return;
    const initialScope = homework.data.canEditShared ? 'shared' : 'personal';
    setScope(initialScope);
    setText(initialScope === 'shared' ? item?.sharedText ?? '' : item?.personalText ?? item?.sharedText ?? '');
  }, [homework.status, item?.updatedAt]);

  const startEditing = (nextScope: 'shared' | 'personal') => {
    setScope(nextScope);
    setText(nextScope === 'shared' ? item?.sharedText ?? '' : item?.personalText ?? item?.sharedText ?? '');
    setNotice(null);
    setEditing(true);
  };

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveHomework(lesson, text.trim(), scope);
      await refresh();
      setEditing(false);
      setNotice(scope === 'shared'
        ? 'Общее ДЗ обновлено для всей группы'
        : 'Личная версия сохранена только для тебя');
      haptic.success();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async (target: 'shared' | 'personal') => {
    setSaving(true);
    setNotice(null);
    try {
      await saveHomework(lesson, null, target);
      await refresh();
      setEditing(false);
      setNotice(target === 'personal' ? 'Теперь показывается общее ДЗ' : 'Общее ДЗ удалено');
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <LessonHeading lesson={lesson} onBack={onBack} />
      <Typography.Title>Домашнее задание</Typography.Title>
      {homework.status === 'loading' && <Loading />}
      {homework.status === 'error' && <ErrorState message={homework.message} onRetry={refresh} />}
      {homework.status === 'ready' && !editing && (
        <div className="stack">
          <div className="homework stack">
            <Typography.Label className="faint">👥 Общее для группы</Typography.Label>
            <Typography.Body className="homework__text">{item?.sharedText || 'Пока не записано'}</Typography.Body>
            {item?.sharedText && (
              <Typography.Label className="muted">
                {item.authorName ? `Записал: ${item.authorName}` : 'Записано в группе'}
                {item.version > 1 ? ` · версия ${item.version}` : ''}
              </Typography.Label>
            )}
          </div>
          <div className={`homework stack${item?.personalText ? ' homework--personal' : ''}`}>
            <Typography.Label className="faint">🔒 Личная версия</Typography.Label>
            <Typography.Body className="homework__text">
              {item?.personalText || 'Нет — используется общее ДЗ'}
            </Typography.Body>
          </div>
          <Button stretched onClick={() => startEditing('personal')}>
            {item?.personalText ? 'Изменить личное ДЗ' : 'Записать себе'}
          </Button>
          {item?.personalText && (
            <Button stretched variant="secondary" disabled={saving} onClick={() => reset('personal')}>
              Вернуть общее ДЗ
            </Button>
          )}
          {canEditShared && (
            <Button stretched variant="secondary" onClick={() => startEditing('shared')}>
              {item?.sharedText ? 'Изменить для группы' : 'Записать для группы'}
            </Button>
          )}
        </div>
      )}
      {homework.status === 'ready' && editing && (
        <div className="stack">
          <Typography.Label className="muted">
            {scope === 'shared' ? 'Общее ДЗ увидит вся группа' : 'Эту версию увидишь только ты'}
          </Typography.Label>
          <Textarea
            autoFocus
            maxLength={2_000}
            placeholder="Например: стр. 45, № 1–10. Подготовить доклад"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Typography.Label className="faint counter">{text.length}/2000</Typography.Label>
          <Button stretched disabled={!text.trim() || saving} onClick={save}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
          <Button stretched variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Отмена</Button>
        </div>
      )}
      {notice && <Typography.Label className="notice" role="status">{notice}</Typography.Label>}
    </div>
  );
};

export const LessonScreen = (props: Props) => {
  useBackButton(props.onBack);
  return <RemoteLessonScreen {...props} />;
};
