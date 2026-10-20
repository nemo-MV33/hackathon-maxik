import { useEffect, useState } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import {
  loadAbsenceHistory, loadAbsences, loadAnnouncements, loadGroupMembers, loadHomeworkViewSummary, publishAnnouncement, removeAnnouncement,
  type AbsenceNote, type Announcement, type HomeworkViewSummary, type RosterMember, type StudentSummary,
} from '../lib/api';
import { addDays, formatMoment, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { useNow } from '../lib/useNow';
import { haptic } from '../bridge/max';
import { TopBar } from '../components/TopBar';
import { ReminderPicker } from '../components/ReminderPicker';
import { StudentList, useReasonLabel } from '../components/Dossier';
import { Empty, ErrorState, Loading } from '../components/Status';
import { BellIcon, CheckIcon, TrashIcon } from '../components/Icon';

type Section = 'late' | 'group' | 'news';
const MAX_TEXT = 1_500;

// Инструменты старосты: кто опаздывает, состав группы по подгруппам и объявления с напоминанием.
export const HeadmanScreen = ({ onOpenProfile, onOpenStudent }: { onOpenProfile: () => void; onOpenStudent: (id: number) => void }) => {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>('late');
  return (
    <div className="screen screen--tabbed screen--headman">
      <TopBar onOpenProfile={onOpenProfile} left={<h1 className="topbar__title">{t.tabHeadman}</h1>} />
      <div className="segment headman-sections" role="tablist" aria-label={t.tabHeadman}>
        {(['late', 'group', 'news'] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={section === item} onClick={() => setSection(item)}>
            {item === 'late' ? t.lateSection : item === 'group' ? t.groupSection : t.newsSection}
          </button>
        ))}
      </div>
      {section === 'late' && <><ViewMedian /><Lateness onOpenStudent={onOpenStudent} /></>}
      {section === 'group' && <Roster />}
      {section === 'news' && <News />}
    </div>
  );
};

// Как быстро группа находит ДЗ: медиана от публикации до первого просмотра за 14 дней.
const ViewMedian = () => {
  const { t } = useI18n();
  const [summary, setSummary] = useState<HomeworkViewSummary | null>(null);
  useEffect(() => {
    let active = true;
    loadHomeworkViewSummary().then((data) => active && setSummary(data)).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!summary || summary.medianMinutes === null) return null;
  return (
    <div className="view-median">
      <span className="view-median__value">{t.viewMedianValue(summary.medianMinutes)}</span>
      <span className="view-median__label">{t.viewMedian}</span>
    </div>
  );
};

const Lateness = ({ onOpenStudent }: { onOpenStudent: (id: number) => void }) => {
  const { t } = useI18n();
  const now = useNow();
  const [offset, setOffset] = useState(0);
  const [notes, setNotes] = useState<AbsenceNote[] | null>(null);
  const [students, setStudents] = useState<StudentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const date = toDateKey(addDays(now, offset));

  useEffect(() => {
    let active = true;
    setNotes(null);
    setError(null);
    loadAbsences(date).then((data) => active && setNotes(data.items)).catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [date, attempt]);
  useEffect(() => {
    let active = true;
    loadAbsenceHistory().then((data) => active && setStudents(data.students)).catch(() => {});
    return () => { active = false; };
  }, [attempt]);

  const late = notes?.filter((note) => note.kind === 'late') ?? [];
  const absent = notes?.filter((note) => note.kind === 'absent') ?? [];
  const lateMinutes = late.reduce((sum, note) => sum + (note.minutes ?? 0), 0);

  return (
    <>
      <div className="segment segment--wide" role="radiogroup" aria-label={t.lateSection}>
        <button type="button" role="radio" aria-checked={offset === 0} onClick={() => setOffset(0)}>{t.today}</button>
        <button type="button" role="radio" aria-checked={offset === -1} onClick={() => setOffset(-1)}>{t.yesterday}</button>
      </div>
      {!notes && !error && <Loading />}
      {error && <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {notes && notes.length === 0 && (
        <div className="all-here">
          <span className="all-here__mark" aria-hidden="true"><CheckIcon size={22} /></span>
          <span className="all-here__text"><span className="all-here__title">{t.allHere}</span><span className="all-here__hint">{t.allHereText}</span></span>
        </div>
      )}
      {notes && notes.length > 0 && (
        <div className="late-summary">
          <div className="late-tile late-tile--late">
            <span className="late-tile__value">{late.length}</span>
            <span className="late-tile__label">{t.statLate}</span>
            {lateMinutes > 0 && <span className="late-tile__extra">{t.lateMinutesTotal(lateMinutes)}</span>}
          </div>
          <div className="late-tile late-tile--absent">
            <span className="late-tile__value">{absent.length}</span>
            <span className="late-tile__label">{t.statAbsent}</span>
          </div>
        </div>
      )}
      {notes && notes.length > 0 && (
        <ul className="late-board" aria-label={t.lateBoardTitle(notes.length)}>{notes.map((note) => <LateCard key={note.id} note={note} />)}</ul>
      )}

      <div className="block-head">
        <h2 className="block-title">{t.dossierTitle}</h2>
        <p className="block-note">{t.dossierHint}</p>
      </div>
      {!students && <Loading />}
      {students && students.length === 0 && <Empty title={t.dossierEmpty}>{t.dossierEmptyText}</Empty>}
      {students && students.length > 0 && <StudentList students={students} onOpen={onOpenStudent} />}
    </>
  );
};

const initials = (name: string | null) => (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

// Карточка сообщения: цвет полосы и кружка — вид отметки, справа — минуты и ответ старосты.
const LateCard = ({ note }: { note: AbsenceNote }) => {
  const { t } = useI18n();
  const reason = useReasonLabel();
  return (
    <li className={`late-card late-card--${note.kind}`}>
      <span className="late-card__avatar" aria-hidden="true">{initials(note.senderName ?? null)}</span>
      <span className="late-card__body">
        <span className="late-card__name">{note.senderName}</span>
        {note.lesson && <span className="late-card__lesson"><span className="mono">{note.lesson.time.slice(0, 5)}</span> {note.lesson.subject}</span>}
        <span className="late-card__reason">{reason(note)}</span>
      </span>
      <span className="late-card__side">
        <span className="late-card__badge">{note.kind === 'late' ? `+${note.minutes ?? '?'} ${t.minutes}` : t.missed}</span>
        <span className={`status-pill status-pill--small${note.acceptedAt ? ' is-ok' : ''}`}>{note.acceptedAt ? t.accepted : t.waiting}</span>
      </span>
    </li>
  );
};

// Состав группы: все, кто выбрал группу в norfly, разложены по подгруппам из личного расписания.
const Roster = () => {
  const { t } = useI18n();
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    loadGroupMembers().then((data) => active && setRoster(data.roster ?? [])).catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [attempt]);

  if (error) return <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!roster) return <Loading />;
  if (roster.length <= 1) return <Empty title={t.rosterEmpty}>{t.rosterEmptyText}</Empty>;
  const groups = ([1, 2, null] as const)
    .map((subgroup) => ({ subgroup, people: roster.filter((member) => member.subgroup === subgroup) }))
    .filter((group) => group.people.length > 0);
  return (
    <>
      <div className="roster-head">
        <span className="roster-head__count">{roster.length}</span>
        <span className="roster-head__text">
          <span className="roster-head__title">{t.rosterCount(roster.length)}</span>
          <span className="roster-head__hint">{t.rosterHint}</span>
        </span>
      </div>
      {groups.map(({ subgroup, people }) => (
        <section key={subgroup ?? 'all'} className={`roster-group roster-group--${subgroup ?? 'all'}`}>
          <header className="roster-group__head">
            <span className="roster-group__title">{subgroup ? t.rosterSubgroup(subgroup) : t.rosterWhole}</span>
            <span className="roster-group__count">{people.length}</span>
          </header>
          {!subgroup && <p className="roster-group__hint">{t.rosterWholeHint}</p>}
          <ul className="roster-list">
            {people.map((member) => (
              <li key={member.userId} className="roster-row">
                <span className="roster-row__avatar" aria-hidden="true">{initials(member.name)}</span>
                <span className={`roster-row__name${member.name ? '' : ' is-hidden'}`}>{member.name ?? t.rosterNoName}</span>
                {member.role === 'headman' && <span className="roster-row__role roster-row__role--headman">{t.roleHeadman} · {t.roleYou}</span>}
                {member.role === 'editor' && <span className="roster-row__role">{t.roleEditor}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};

const News = () => {
  const { t } = useI18n();
  const now = useNow();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = () => loadAnnouncements().then((data) => setItems(data.items)).catch((failure: Error) => setError(failure.message));
  useEffect(() => { void reload(); }, []);

  const publish = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const { postedToChat } = await publishAnnouncement({ text: text.trim(), remindAt });
      haptic.success();
      setText('');
      setRemindAt(null);
      setNotice({ tone: 'ok', text: postedToChat ? t.publishedEverywhere : t.publishedDm });
      await reload();
    } catch (failure) {
      setNotice({ tone: 'error', text: (failure as Error).message });
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    if (confirm !== id) { setConfirm(id); return; }
    try {
      await removeAnnouncement(id);
      setConfirm(null);
      await reload();
    } catch (failure) {
      setNotice({ tone: 'error', text: (failure as Error).message });
    }
  };

  return (
    <>
      <div className="block-head">
        <h2 className="block-title">{t.newAnnouncement}</h2>
        <p className="block-note">{t.newAnnouncementHint}</p>
      </div>
      <div className="editor__body">
        <Textarea aria-label={t.newAnnouncement} rows={4} maxLength={MAX_TEXT} placeholder={t.announcementPlaceholder} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <ReminderPicker title={t.remindGroup} value={remindAt} onChange={setRemindAt} now={now} />
      <Button stretched size="large" disabled={!text.trim()} loading={sending} onClick={publish}>{t.publish}</Button>
      {notice && <p className={`toast toast--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

      <div className="block-head">
        <h2 className="block-title">{t.publishedTitle}</h2>
      </div>
      {!items && !error && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {items && items.length === 0 && <Empty title={t.noAnnouncements} />}
      {items && items.length > 0 && (
        <ul className="tasks">
          {items.map((item) => (
            <li key={item.id} className="task task--announcement task--static">
              <span className="task__top">
                <span className="task__when">{formatMoment(item.createdAt)}</span>
                {item.remindAt && <span className="task__bell"><BellIcon size={13} />{formatMoment(item.remindAt)}</span>}
              </span>
              <span className="task__text task__text--full">{item.text}</span>
              {item.mine && (
                <button type="button" className={`text-button text-button--danger${confirm === item.id ? ' is-confirm' : ''}`} onClick={() => remove(item.id)}>
                  <TrashIcon size={16} />{confirm === item.id ? t.confirmRemove : t.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
