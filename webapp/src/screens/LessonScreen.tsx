import { HomeworkCompletion } from '../components/HomeworkCompletion';
import { HomeworkDetails, HomeworkDetailsEditor } from '../components/HomeworkDetails';
import { HomeworkHistory } from '../components/HomeworkHistory';
import type { Deadline, Submission } from '../data/homework';
import { AttachmentEditor, AttachmentList, type HomeworkAttachment } from '../components/HomeworkAttachments';
import { userTimeZone, dateInZone, lessonDate, lessonTime, lessonMoment } from '../lib/timezone';
import { LessonMove } from '../components/LessonMove';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { homeworkKey, saveHomework, useRemoteHomework, type HomeworkData } from '../data/homework';
import { hasNativeBackButton, haptic } from '../bridge/max';
import { formatDay, formatMoment, formatStamp, fromDateKey } from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useBackButton } from '../lib/useBackButton';
import { ErrorState, Loading } from '../components/Status';
import { ChevronLeft } from '../components/Icon';
import { isControlLesson, lessonKindClass, lessonKindName } from '../lib/lessonKind';
import { useI18n } from '../lib/i18n';
import { AbsenceSheet } from '../components/AbsenceSheet';
import { loadAbsences, recordHomeworkView, type AbsenceKind, type AbsenceNote, type HomeworkReach } from '../lib/api';
import { useNow } from '../lib/useNow';
import { ReminderPicker } from '../components/ReminderPicker';
import { groupTimeZone, universityClock } from '../lib/universities';

type Props = {
  lesson: Lesson;
  homeworkFirst?: boolean;
  profile: LocalProfile;
  profileRevision: number;
  onBack: () => void;
};

type Scope = 'shared' | 'personal';

const MAX_LENGTH = 2_000;

// Где, кто и для кого. Время и дата — в шапке, здесь их не повторяем.
const LessonFacts = ({ lesson }: { lesson: Lesson }) => {
  const { t } = useI18n();
  const rows = [
    lesson.auditories.length > 0 && [t.where, <>{lesson.auditories.join(', ')}{lesson.building && <small>{lesson.building}</small>}</>],
    lesson.teachers.length > 0 && [t.who, lesson.teachers.join(', ')],
    lesson.subgroup && [t.forWhom, t.forSubgroup(lesson.subgroup)],
    lesson.comment && [t.note, lesson.comment],
  ].filter(Boolean) as [string, ReactNode][];
  if (!rows.length) return null;
  return <dl className="facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
};

const LessonHeading = ({ lesson }: { lesson: Lesson }) => {
  const { t } = useI18n();
  const otherZone = userTimeZone() !== (lesson.timeZone || groupTimeZone(lesson.groupId));
  return (
  <header className={`lesson-head ${lesson.standalone ? 'kind-other' : lessonKindClass(lesson.lessonType)}${isControlLesson(lesson.lessonType) ? ' is-control' : ''}`}>
    <p className="eyebrow">
      <span className="kind-code">{lesson.standalone ? t.homeworkShort : lessonKindName(lesson.lessonType)}</span>
      {lesson.transferred && <span className="flag">{t.transferred}</span>}
    </p>
    <h1 className="display">{lesson.subject}</h1>
    {!lesson.standalone && <p className="lesson-head__when">
      <span className="first-letter">{formatDay(fromDateKey(lessonDate(lesson)))}</span>
      <span className="mono">{lessonTime(lesson)}</span>
      {otherZone && <small>{lesson.time.slice(0, 5)} {universityClock(lesson.groupId)}</small>}
    </p>}
  </header>
  );
};

export const LessonScreen = ({ lesson, homeworkFirst = false, profile, profileRevision, onBack }: Props) => {
  const { t } = useI18n();
  const [homework, refresh] = useRemoteHomework(profile.group.id, lesson.date, lesson.date, profileRevision);
  const item = homework.status === 'ready'
    ? homework.data.items.find((candidate) => homeworkKey(candidate) === homeworkKey(lesson))
    : undefined;
  const canEditShared = homework.status === 'ready' && homework.data.canEditShared;
  const [scope, setScope] = useState<Scope>('personal');
  const [text, setText] = useState('');
  const [deadline, setDeadline] = useState<Deadline>({ kind: 'lesson' });
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [files, setFiles] = useState<HomeworkAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [absence, setAbsence] = useState<AbsenceKind | null>(null);
  const [myNotes, setMyNotes] = useState<AbsenceNote[]>([]);

  useEffect(() => {
    if (absence) return undefined;
    let active = true;
    loadAbsences(lesson.date)
      .then((data) => active && setMyNotes(data.role === 'student'
        ? data.items.filter((note) => !note.lesson || note.lesson.lessonNumber === lesson.lessonNumber)
        : []))
      .catch(() => {});
    return () => { active = false; };
  }, [absence, lesson.date, lesson.lessonNumber]);
  const now = useNow();
  const lessonOver = Date.parse(lessonMoment(lesson, true)) <= Date.now();

  // Во время редактирования системная «Назад» закрывает редактор, а не экран пары.
  useBackButton(editing && !saving ? () => setEditing(false) : onBack);

  useEffect(() => {
    if (!notice || notice.tone === 'error') return undefined;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const startEditing = (nextScope: Scope) => {
    setScope(nextScope);
    const nextDeadline = (nextScope === 'shared' ? item?.sharedDeadline : item?.personalDeadline) ?? { kind: 'lesson' };
    setDeadline(lesson.standalone && nextDeadline.kind !== 'date' ? item?.deadline ?? { kind: 'date', local: `${lesson.date}T18:00` } : nextDeadline);
    setSubmission((nextScope === 'shared' ? item?.sharedSubmission : item?.personalSubmission) ?? null);
    setFiles(nextScope === 'shared' ? item?.sharedAttachments ?? [] : item?.personalAttachments ?? []);
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
    if ((!text.trim() && !files.length) || saving || uploading) return;
    void run(
      () => saveHomework(lesson, text.trim(), scope, undefined, undefined, undefined, files, { deadline, submission }),
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

  const hasShared = Boolean(item?.sharedText || item?.sharedAttachments?.length);
  const hasPersonal = Boolean(item?.personalText || item?.personalAttachments?.length);
  const canManage = hasPersonal || (canEditShared && hasShared);
  const [reach, setReach] = useState<HomeworkReach | null>(null);

  // Фиксируем просмотр общего ДЗ; старосте и редакторам сервер заодно отдаёт охват.
  useEffect(() => {
    if (!hasShared) return undefined;
    let active = true;
    recordHomeworkView(lesson).then((data) => active && setReach(data.reach)).catch(() => {});
    return () => { active = false; };
  }, [hasShared, lesson.date, lesson.lessonNumber, lesson.subgroup]);

  // Сведения о паре: факты, отметка переноса и «опоздаю / не приду».
  const information = !lesson.standalone && <>
    <LessonFacts lesson={lesson} />
    {lesson.markedBy && lesson.markedAt && <p className="note-line">{t.moveMarked(lesson.markedBy, formatStamp(lesson.markedAt))}</p>}
    {item?.status === 'orphaned' && <p className="note-line" role="status">{t.orphaned}</p>}
    {!lessonOver && <div className="absence-actions">
      <button type="button" className="pill-button pill-button--late" onClick={() => setAbsence('late')}>{t.late}</button>
      <button type="button" className="pill-button pill-button--absent" onClick={() => setAbsence('absent')}>{t.absent}</button>
    </div>}
    {myNotes.length > 0 && (
      <div className="notes">
        {myNotes.map((note) => (
          <p key={note.id} className="note-status">
            <span>{t.lateKind(note.kind)}, {note.reason ? t.absenceReasons[note.reason] : note.text}</span>
            <span className={`status-pill status-pill--small${note.acceptedAt ? ' is-ok' : ''}`}>{note.acceptedAt ? t.accepted : t.waiting}</span>
          </p>
        ))}
      </div>
    )}
  </>;

  return (
    <div className={homeworkFirst ? 'screen screen--lesson screen--homework' : 'screen screen--lesson'}>
      {!hasNativeBackButton() && (
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={18} />{homeworkFirst ? t.back : t.scheduleBack}</button>
      )}
      <LessonHeading lesson={lesson} />
      {!homeworkFirst && information}

      <section className="homework" aria-labelledby="homework-title">
        <h2 id="homework-title" className="section-title">{t.homeworkTitle}</h2>

        {homework.status === 'loading' && <Loading />}
        {homework.status === 'error' && <ErrorState message={homework.message} onRetry={() => refresh()} />}

        {homework.status === 'ready' && !editing && (
          <>
            {(hasShared || !hasPersonal) && <article className="hw-block">
              <p className="hw-block__label">{t.forGroup}</p>
              {item?.sharedText
                ? <p className="hw-block__text">{item.sharedText}</p>
                : !item?.sharedAttachments?.length && <p className="hw-block__empty">{t.nobodyWrote}</p>}
              <AttachmentList files={item?.sharedAttachments} />
              {hasShared && item && <HomeworkDetails deadline={item.sharedDeadline} submission={item.sharedSubmission} completed={item.completed} dueAt={item.sharedDueAt ?? (item.source === 'shared' ? item.dueAt : null)} />}
              {hasShared && item && <p className="hw-block__meta">
                {[item.sharedAuthorName ?? item.authorName, formatStamp(item.sharedUpdatedAt ?? item.updatedAt), (item.sharedVersion ?? item.version) > 1 && t.edit(item.sharedVersion ?? item.version)].filter(Boolean).join(' · ')}
              </p>}
              {hasShared && reach && reach.total > 0 && <p className="hw-block__reach">{t.seenBy(reach.seen, reach.total)}</p>}
              {item?.source === 'shared' && <HomeworkCompletion item={item} onSaved={() => refresh(true)} />}
              {(hasShared || !!item?.sharedHistory?.length) && <HomeworkHistory history={item?.sharedHistory ?? []} lesson={lesson} canRestore={homework.data.role === 'headman' || homework.data.role === 'editor'} currentVersion={item?.sharedVersion} onSaved={() => refresh(true)} />}
            </article>}
            {hasPersonal && item && <article className="hw-block hw-block--personal">
              <p className="hw-block__label">{t.forMe}</p>
              {item.personalText && <p className="hw-block__text">{item.personalText}</p>}
              <AttachmentList files={item.personalAttachments} />
              <HomeworkDetails deadline={item.personalDeadline} submission={item.personalSubmission} completed={item.completed} dueAt={item.personalDueAt ?? (item.source === 'personal' ? item.dueAt : null)} />
              {item.source === 'personal' && <HomeworkCompletion item={item} onSaved={() => refresh(true)} />}
              <HomeworkHistory history={item.personalHistory ?? []} lesson={lesson} onSaved={() => refresh(true)} />
            </article>}

            <div className="homework-edit-actions">
              {canEditShared && (
                <Button stretched size="large" onClick={() => startEditing('shared')}>
                  {hasShared ? t.editGroupShort : t.writeGroupShort}
                </Button>
              )}
              <Button stretched size="large" variant={canEditShared ? 'secondary' : 'primary'} onClick={() => startEditing('personal')}>
                {hasPersonal ? t.editOwnShort : t.writeOwnShort}
              </Button>
            </div>

            {(item?.text || !!item?.attachments?.length) && (
              <ReminderPicker
                disabled={saving}
                options={[
                  ...(!lesson.standalone ? [{ id: 'lesson', label: t.beforeLesson, selected: item.reminderMode === 'lesson', onSelect: () => void run(() => saveHomework(lesson, null, 'reminder', new Date(Date.parse(lessonMoment(lesson)) - 600_000).toISOString(), 'lesson', 10), t.beforeLesson) }] : []),
                  ...(['due-day', 'due-morning'] as const).map((mode) => ({ id: mode, label: mode === 'due-day' ? t.dueDay : t.dueMorning, selected: item.reminderMode === mode, disabled: !item.dueAt, onSelect: () => void run(() => saveHomework(lesson, null, 'reminder', item.dueAt, mode), t.reminder) })),
                ]}
                value={item.remindAt}
                dateKey={lesson.standalone && item.dueAt ? dateInZone(new Date(item.dueAt)) : lessonDate(lesson)}
                now={now}
                onChange={(value) => void run(() => saveHomework(lesson, null, 'reminder', value), value ? t.reminderSet(formatMoment(value)) : t.reminderOff)}
              />
            )}

            {canManage && <div className="quiet-actions">
              {hasPersonal && <button type="button" className="text-button text-button--muted" disabled={saving} onClick={() => remove('personal')}>{t.deleteOwn}</button>}
              {canEditShared && hasShared && <button type="button" className={`text-button text-button--danger${confirmDelete ? ' is-confirm' : ''}`} disabled={saving} onClick={() => remove('shared')}>
                {confirmDelete ? t.confirmDelete : t.deleteShared}
              </button>}
            </div>}
          </>
        )}

        {homework.status === 'ready' && editing && (
          <div className="editor">
            <p className="editor__scope">{scope === 'shared' ? t.sharedScope : t.ownScope}</p>
            <div className="editor__body">
              <Textarea
                autoFocus
                aria-label={t.fieldTask}
                maxLength={MAX_LENGTH}
                rows={4}
                placeholder={t.placeholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              {text.length > MAX_LENGTH * 0.8 && <p className={`editor__counter${text.length > MAX_LENGTH * 0.9 ? ' is-near' : ''}`}>{text.length} / {MAX_LENGTH}</p>}
              <AttachmentEditor files={files} scope={scope} onChange={setFiles} onBusy={setUploading} />
            </div>
            <HomeworkDetailsEditor groupId={profile.group.id} standalone={lesson.standalone} deadline={deadline} submission={submission} onDeadline={setDeadline} onSubmission={setSubmission} />
            <div className="actions">
              <Button stretched size="large" disabled={uploading || (!text.trim() && !files.length)} loading={saving} onClick={save}>{t.save}</Button>
              <Button stretched variant="ghost" disabled={saving} onClick={() => setEditing(false)}>{t.cancel}</Button>
            </div>
          </div>
        )}

        {notice && (
          <p className={`toast toast--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>
        )}
      </section>
      {homeworkFirst && information}
      {canEditShared && !lesson.standalone && !editing && (
        <section className="lesson-admin" aria-label={t.headmanTools}>
          <p className="field-label">{t.headmanTools}</p>
          <LessonMove lesson={lesson} groupId={profile.group.id} onSaved={onBack} />
        </section>
      )}
      {absence && <AbsenceSheet kind={absence} lesson={lesson} onClose={() => setAbsence(null)} />}
    </div>
  );
};
