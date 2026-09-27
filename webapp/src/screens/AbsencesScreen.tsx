import { useEffect, useState } from 'react';
import { Button } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import {
  loadAbsenceHistory, loadGroupMembers, loadStudentDossier, saveDeputy,
  type AbsenceHistory, type AbsenceKind, type Member, type StudentDossier,
} from '../lib/api';
import { addDays, formatDuration, timeToMinutes, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';
import { loadLessons } from '../lib/lessons';
import { haptic } from '../bridge/max';
import { BackHeader } from '../components/BackHeader';
import { AbsenceSheet } from '../components/AbsenceSheet';
import { NoteRow, StudentList } from '../components/Dossier';
import { Sheet } from '../components/Sheet';
import { Empty, ErrorState, Loading } from '../components/Status';

type Props = { profile: LocalProfile; onBack: () => void; onOpenStudent: (id: number) => void };

// Опоздания: предупредить о конкретной паре, посмотреть свою историю.
// Старосте — ещё выбор доверенного одногруппника и «досье» по группе.
export const AbsencesScreen = ({ profile, onBack, onOpenStudent }: Props) => {
  const { t } = useI18n();
  const { me, refresh: refreshMe } = useMe();
  const now = useNow();
  const todayKey = toDateKey(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [lessons] = useAsync(() => loadLessons(profile.group.id, profile.subgroup, todayKey, toDateKey(addDays(now, 7))), [profile.group.id, profile.subgroup, todayKey]);
  const [history, setHistory] = useState<AbsenceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lessonKey, setLessonKey] = useState<string | null>(null);
  const [absence, setAbsence] = useState<AbsenceKind | null>(null);
  const [pickDeputy, setPickDeputy] = useState(false);
  const isHeadman = me?.role === 'headman';

  useEffect(() => {
    let active = true;
    loadAbsenceHistory().then((data) => active && setHistory(data)).catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [attempt]);

  // Предупредить можно о парах, которые ещё не закончились: сегодня и в ближайшие дни.
  const upcoming = (lessons.status === 'ready' ? lessons.data : [])
    .filter((lesson) => lesson.date > todayKey || timeToMinutes(lesson.time.slice(6, 11)) > nowMinutes);
  const firstDay = upcoming[0]?.date;
  const choices = upcoming.filter((lesson) => lesson.date === firstDay);
  const key = (lesson: Lesson) => `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;
  const selected = choices.find((lesson) => key(lesson) === lessonKey) ?? choices[0];
  const totalMine = history?.mine.reduce((sum, note) => sum + (note.minutes ?? 0), 0) ?? 0;
  const blocked = isHeadman && !me?.deputy;

  return (
    <div className="screen screen--section">
      <BackHeader label={t.profile} onBack={onBack} title={t.absencesSection} />

      {isHeadman && (
        <div className={`callout-card${me?.deputy ? '' : ' callout-card--warn'}`}>
          <p className="callout-card__title">{me?.deputy ? t.deputyIs(me.deputy.name) : t.deputyMissing}</p>
          <p className="callout-card__text">{t.deputyExplain}</p>
          <button type="button" className="text-button" onClick={() => setPickDeputy(true)}>{me?.deputy ? t.deputyChange : t.deputyChoose}</button>
        </div>
      )}

      <section className="report-card" aria-labelledby="report-title">
        <h2 id="report-title" className="block-title">{t.reportTitle}</h2>
        {lessons.status === 'loading' && <Loading />}
        {lessons.status === 'ready' && choices.length === 0 && <p className="hint">{t.noLessonsToReport}</p>}
        {choices.length > 0 && (
          <>
            <p className="field-label">{firstDay === todayKey ? t.whichLessonToday : t.whichLessonNext}</p>
            <div className="choice-list choice-list--compact" role="radiogroup" aria-label={t.whichLessonToday}>
              {choices.map((lesson) => (
                <button key={key(lesson)} type="button" role="radio" className="choice choice--compact" aria-checked={selected && key(selected) === key(lesson)} onClick={() => setLessonKey(key(lesson))}>
                  <span className="choice__text">
                    <span className="choice__title">{lesson.subject}</span>
                    <span className="choice__hint">{lesson.time} · {lesson.auditories.join(', ') || lesson.lessonType}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="absence-actions absence-actions--wide">
              <button type="button" className="pill-button" disabled={blocked} onClick={() => setAbsence('late')}>{t.late}</button>
              <button type="button" className="pill-button" disabled={blocked} onClick={() => setAbsence('absent')}>{t.absent}</button>
            </div>
            {blocked && <p className="hint">{t.chooseDeputyFirst}</p>}
          </>
        )}
      </section>

      <div className="block-head">
        <h2 className="block-title">{t.myHistory}</h2>
        {history && history.mine.length > 0 && <p className="block-note">{t.myHistoryTotal(formatDuration(totalMine), history.mine.length)}</p>}
      </div>
      {!history && !error && <Loading />}
      {error && <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {history && history.mine.length === 0 && <Empty title={t.historyEmpty}>{t.historyEmptyText}</Empty>}
      {history && history.mine.length > 0 && <div className="notes">{history.mine.map((note) => <NoteRow key={note.id} note={note} />)}</div>}

      {isHeadman && history && (
        <>
          <div className="block-head">
            <h2 className="block-title">{t.dossierTitle}</h2>
            <p className="block-note">{t.dossierHint}</p>
          </div>
          {history.students.length === 0 ? <Empty title={t.dossierEmpty} /> : <StudentList students={history.students} onOpen={onOpenStudent} />}
        </>
      )}

      {absence && selected && (
        <AbsenceSheet kind={absence} lesson={selected} onClose={() => setAbsence(null)} onSent={() => setAttempt((value) => value + 1)} />
      )}
      {pickDeputy && <DeputySheet current={me?.deputy ?? null} onClose={() => setPickDeputy(false)} onSaved={() => { void refreshMe(); }} />}
    </div>
  );
};

const DeputySheet = ({ current, onClose, onSaved }: { current: Member | null; onClose: () => void; onSaved: () => void }) => {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    loadGroupMembers().then((data) => setMembers(data.members)).catch((failure: Error) => setError(failure.message));
  }, []);

  const choose = async (userId: number) => {
    setSaving(userId);
    try {
      await saveDeputy(userId);
      haptic.success();
      onSaved();
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
      setSaving(null);
    }
  };

  return (
    <Sheet title={t.deputyPickTitle} hint={t.deputyPickHint} labelId="deputy-title" onClose={onClose} busy={saving !== null}>
      {!members && !error && <Loading />}
      {error && <p className="toast toast--error" role="alert">{error}</p>}
      {members && members.length === 0 && <p className="callout">{t.deputyNobody}</p>}
      {members && members.length > 0 && (
        <div className="choice-list choice-list--compact" role="radiogroup" aria-label={t.deputyPickTitle}>
          {members.map((member) => (
            <button key={member.userId} type="button" role="radio" className="choice choice--compact" aria-checked={current?.userId === member.userId} data-current={t.current} disabled={saving !== null} onClick={() => choose(member.userId)}>
              <span className="choice__text"><span className="choice__title">{member.name}</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="actions"><Button stretched variant="ghost" onClick={onClose}>{t.cancel}</Button></div>
    </Sheet>
  );
};

// Досье студента для старосты: где, когда, насколько и почему.
export const StudentScreen = ({ id, onBack }: { id: number; onBack: () => void }) => {
  const { t } = useI18n();
  const [data, retry] = useAsync<StudentDossier>(() => loadStudentDossier(id), [id]);
  const student = data.status === 'ready' ? data.data.student : null;
  return (
    <div className="screen screen--section">
      <BackHeader label={t.dossierTitle} onBack={onBack} title={student?.name ?? ' '} eyebrow={t.dossierOf} />
      {data.status === 'loading' && <Loading />}
      {data.status === 'error' && <ErrorState message={data.message} onRetry={retry} />}
      {student && (
        <>
          <div className="stat-row">
            <div className="stat stat--wide"><span className="stat__value">{formatDuration(student.totalMinutes)}</span><span className="stat__label">{t.totalMissed}</span></div>
            <div className="stat"><span className="stat__value">{student.late}</span><span className="stat__label">{t.statLate}</span></div>
            <div className="stat"><span className="stat__value">{student.absent}</span><span className="stat__label">{t.statAbsent}</span></div>
          </div>
          <p className="hint">{t.totalExplain}</p>
          <div className="notes">{student.items.map((note) => <NoteRow key={note.id} note={note} />)}</div>
        </>
      )}
    </div>
  );
};
