import { useEffect, useState } from 'react';
import { Button, Textarea, Typography } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { haptic, miniAppLink, shareText, type ShareResult } from '../bridge/max';
import { encodeHomework, fitsInLink, homeworkId, removeHomework, saveHomework, useHomework, type Homework } from '../lib/homework';
import { formatDay, fromDateKey } from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useBackButton } from '../lib/useBackButton';

const SHARE_MESSAGES: Record<ShareResult, string> = {
  max: 'Выбери чат группы, чтобы отправить ДЗ',
  native: 'ДЗ отправлено',
  clipboard: 'Текст со ссылкой скопирован — вставь его в чат группы',
  failed: 'Не получилось поделиться. Попробуй ещё раз',
};

export const LessonScreen = ({ lesson, profile, onBack }: { lesson: Lesson; profile: LocalProfile; onBack: () => void }) => {
  useBackButton(onBack);
  const items = useHomework();
  const id = homeworkId(profile.group.id, lesson);
  const saved = items[id];
  const [text, setText] = useState(saved?.text ?? '');
  const [editing, setEditing] = useState(!saved);
  const [tooLong, setTooLong] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const draft: Homework = {
    groupId: profile.group.id,
    date: lesson.date,
    lessonNumber: lesson.lessonNumber,
    subgroup: lesson.subgroup,
    subject: lesson.subject,
    text: text.trim(),
    updatedAt: new Date().toISOString(),
  };

  useEffect(() => {
    let active = true;
    fitsInLink(draft).then((fits) => active && setTooLong(!fits));
    return () => { active = false; };
  }, [text]);

  const save = () => {
    if (!draft.text) return;
    saveHomework({ ...draft, sharedBy: saved?.sharedBy });
    setEditing(false);
    setNotice('ДЗ сохранено');
    haptic.success();
  };

  const share = async () => {
    const item = saved ?? draft;
    const link = miniAppLink(await encodeHomework(item));
    const message = `📚 ДЗ · ${profile.group.title}\n${lesson.subject} — ${formatDay(fromDateKey(lesson.date))}, ${lesson.time.slice(0, 5)}\n\n${item.text}\n\nСохранить в norfly:`;
    const result = await shareText(message, link);
    setNotice(SHARE_MESSAGES[result]);
    if (result !== 'failed') saveHomework({ ...item, sharedBy: 'me' });
  };

  return (
    <div className="screen">
      <Button size="small" variant="ghost" className="back" onClick={onBack}>← К расписанию</Button>
      <div className="stack">
        <Typography.Headline>{lesson.subject}</Typography.Headline>
        <Typography.Body className="muted first-letter">
          {formatDay(fromDateKey(lesson.date))} · {lesson.time}
        </Typography.Body>
        <Typography.Label className="muted">
          {[lesson.lessonType, lesson.subgroup && `${lesson.subgroup} подгруппа`, ...lesson.auditories, ...lesson.teachers]
            .filter(Boolean).join(' · ')}
        </Typography.Label>
        {lesson.comment && <Typography.Label className="muted">{lesson.comment}</Typography.Label>}
      </div>

      <Typography.Title>Домашнее задание</Typography.Title>
      {editing ? (
        <div className="stack">
          <Textarea
            autoFocus={!saved}
            placeholder="Например: стр. 45, № 1–10. Подготовить доклад"
            value={text}
            onChange={(event) => { setText(event.target.value); setNotice(null); }}
          />
          {tooLong && (
            <Typography.Label className="error-text">
              Слишком длинно, чтобы поделиться ссылкой. Сократи текст
            </Typography.Label>
          )}
          <Button stretched disabled={!text.trim()} onClick={save}>Сохранить</Button>
          {saved && (
            <Button stretched variant="ghost" onClick={() => { setText(saved.text); setEditing(false); }}>
              Отмена
            </Button>
          )}
        </div>
      ) : (
        <div className="stack">
          <div className="homework">
            <Typography.Body className="homework__text">{saved?.text}</Typography.Body>
            {saved?.sharedBy === 'import' && (
              <Typography.Label className="muted">Получено от одногруппника</Typography.Label>
            )}
          </div>
          <Button stretched disabled={tooLong} onClick={share}>Поделиться с группой</Button>
          <div className="row">
            <Button stretched variant="secondary" onClick={() => setEditing(true)}>Изменить</Button>
            <Button
              stretched
              variant="secondary"
              onClick={() => { removeHomework(id); setText(''); setEditing(true); setNotice('ДЗ удалено'); }}
            >
              Удалить
            </Button>
          </div>
        </div>
      )}
      {notice && <Typography.Label className="notice" role="status">{notice}</Typography.Label>}
    </div>
  );
};
