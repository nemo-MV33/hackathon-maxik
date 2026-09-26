import { useEffect, useState } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { homeworkKey, saveHomework, useRemoteHomework, type HomeworkData } from '../data/homework';
import { hasNativeBackButton, haptic, openExternal } from '../bridge/max';
import { formatDay, formatStamp, fromDateKey } from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useBackButton } from '../lib/useBackButton';
import { ErrorState, Loading } from '../components/Status';
import { ChevronLeft } from '../components/Icon';
import { isControlLesson, lessonKindClass, lessonKindCode, lessonKindName } from '../lib/lessonKind';
import { useI18n } from '../lib/i18n';

type Props = {
  lesson: Lesson;
  profile: LocalProfile;
  profileRevision: number;
  onBack: () => void;
};

type Scope = 'shared' | 'personal';

const MAX_LENGTH = 2_000;

const safeLink = (link?: string) => (link && /^https?:\/\//i.test(link) ? link : undefined);

const LessonFacts = ({ lesson }: { lesson: Lesson }) => {
  const { t } = useI18n();
  return (
  <dl className="facts">
    <div><dt>{t.when}</dt><dd className="first-letter">{formatDay(fromDateKey(lesson.date))}<br /><span className="mono">{lesson.time}</span> · {t.pair(lesson.lessonNumber)}</dd></div>
    {lesson.auditories.length > 0 && <div><dt>{t.where}</dt><dd>{lesson.auditories.join(', ')}</dd></div>}
    {lesson.teachers.length > 0 && <div><dt>{t.who}</dt><dd>{lesson.teachers.join(', ')}</dd></div>}
    {lesson.subgroup && <div><dt>{t.forWhom}</dt><dd>{t.forSubgroup(lesson.subgroup)}</dd></div>}
    {lesson.comment && <div><dt>{t.note}</dt><dd>{lesson.comment}</dd></div>}
    {safeLink(lesson.link) && (
      <div><dt>{t.link}</dt><dd><a
        href={safeLink(lesson.link)}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => { if (openExternal(lesson.link!)) event.preventDefault(); }}
      >{lesson.link!.replace(/^https?:\/\//i, '')}</a></dd></div>
    )}
  </dl>
  );
};

const LessonHeading = ({ lesson }: { lesson: Lesson }) => {
  const { t } = useI18n();
  return (
  <header className={`lesson-head ${lessonKindClass(lesson.lessonType)}${isControlLesson(lesson.lessonType) ? ' is-control' : ''}`}>
    <p className="eyebrow">
      <span className="kind-code">{lessonKindCode(lesson.lessonType)}</span>
      {lessonKindName(lesson.lessonType)}
      {lesson.transferred && <span className="flag">{t.transferred}</span>}
    </p>
    <h1 className="display">{lesson.subject}</h1>
  </header>
  );
};

export const LessonScreen = ({ lesson, profile, profileRevision, onBack }: Props) => {
  const { t } = useI18n();
  const [homework, refresh] = useRemoteHomework(profile.group.id, lesson.date, lesson.date, profileRevision);
  const item = homework.status === 'ready'
    ? homework.data.items.find((candidate) => homeworkKey(candidate) === homeworkKey(lesson))
    : undefined;
  const canEditShared = homework.status === 'ready' && homework.data.canEditShared;
  const [scope, setScope] = useState<Scope>('personal');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Во время редактирования системная «Назад» закрывает редактор, а не экран пары.
  useBackButton(editing && !saving ? () => setEditing(false) : onBack);

  useEffect(() => {
    if (!notice || notice.tone === 'error') return undefined;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const startEditing = (nextScope: Scope) => {
    setScope(nextScope);
    setText(nextScope === 'shared' ? item?.sharedText ?? '' : item?.personalText ?? item?.sharedText ?? '');
    setNotice(null);
    setConfirmDelete(false);
    setEditing(true);
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await action();
      await refresh(true);
      setEditing(false);
      setConfirmDelete(false);
      setNotice({ tone: 'ok', text: success });
      haptic.success();
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!text.trim() || saving) return;
    void run(
      () => saveHomework(lesson, text.trim(), scope),
      scope === 'shared' ? t.savedShared : t.savedOwn,
    );
  };

  const remove = (target: Scope) => {
    if (target === 'shared' && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void run(
      () => saveHomework(lesson, null, target),
      target === 'personal' ? t.deletedOwn : t.deletedShared,
    );
  };

  return (
    <div className="screen screen--lesson">
      {!hasNativeBackButton() && (
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={18} />{t.scheduleBack}</button>
      )}
      <LessonHeading lesson={lesson} />
      <LessonFacts lesson={lesson} />

      <section className="homework" aria-labelledby="homework-title">
        <div className="section-head">
          <h2 id="homework-title" className="section-title">{t.homeworkTitle}</h2>
          {homework.status === 'ready' && <p className="section-note">{t.roles[homework.data.role]}</p>}
        </div>

        {homework.status === 'loading' && <Loading />}
        {homework.status === 'error' && <ErrorState message={homework.message} onRetry={() => refresh()} />}

        {homework.status === 'ready' && !editing && (
          <>
            <div className="hw-block">
              <p className="hw-block__label">{t.forGroup}</p>
              {item?.sharedText
                ? <p className="hw-block__text">{item.sharedText}</p>
                : <p className="hw-block__empty">{t.nobodyWrote}</p>}
              {item?.sharedText && (
                <p className="hw-block__meta">
                  {[item.authorName, formatStamp(item.updatedAt), item.version > 1 && t.edit(item.version)].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className={`hw-block${item?.personalText ? ' hw-block--personal' : ''}`}>
              <p className="hw-block__label">{t.forMe}</p>
              {item?.personalText
                ? <p className="hw-block__text">{item.personalText}</p>
                : <p className="hw-block__empty">{t.noOwnVersion}</p>}
            </div>

            <div className="actions">
              {canEditShared && (
                <Button stretched size="large" onClick={() => startEditing('shared')}>
                  {item?.sharedText ? t.editShared : t.writeShared}
                </Button>
              )}
              <Button stretched size="large" variant={canEditShared ? 'secondary' : 'primary'} onClick={() => startEditing('personal')}>
                {item?.personalText ? t.editOwn : t.writeOwn}
              </Button>
              {item?.personalText && (
                <Button stretched variant="ghost" disabled={saving} onClick={() => remove('personal')}>
                  {t.deleteOwn}
                </Button>
              )}
              {canEditShared && item?.sharedText && (
                <Button
                  stretched
                  variant={confirmDelete ? 'destructive' : 'ghost'}
                  loading={saving && confirmDelete}
                  onClick={() => remove('shared')}
                >
                  {confirmDelete ? t.confirmDelete : t.deleteShared}
                </Button>
              )}
            </div>
          </>
        )}

        {homework.status === 'ready' && editing && (
          <div className="editor">
            <p className="editor__scope">
              {scope === 'shared' ? t.sharedScope : t.ownScope}
            </p>
            <Textarea
              autoFocus
              maxLength={MAX_LENGTH}
              rows={6}
              placeholder={t.placeholder}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className={`editor__counter${text.length > MAX_LENGTH * 0.9 ? ' is-near' : ''}`}>{text.length} / {MAX_LENGTH}</p>
            <div className="actions">
              <Button stretched size="large" disabled={!text.trim()} loading={saving} onClick={save}>{t.save}</Button>
              <Button stretched variant="ghost" disabled={saving} onClick={() => setEditing(false)}>{t.cancel}</Button>
            </div>
          </div>
        )}

        {notice && (
          <p className={`toast toast--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>
        )}
      </section>
    </div>
  );
};
