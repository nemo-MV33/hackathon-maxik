import { useEffect, useState } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import {
  loadAbsenceHistory, loadAbsences, loadAnnouncements, publishAnnouncement, removeAnnouncement,
  type AbsenceNote, type Announcement, type StudentSummary,
} from '../lib/api';
import { addDays, formatMoment, toDateKey } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { useNow } from '../lib/useNow';
import { haptic } from '../bridge/max';
import { TopBar } from '../components/TopBar';
import { ReminderPicker } from '../components/ReminderPicker';
import { NoteRow, StudentList } from '../components/Dossier';
import { Empty, ErrorState, Loading } from '../components/Status';
import { BellIcon, TrashIcon } from '../components/Icon';

type Section = 'late' | 'news';
const MAX_TEXT = 1_500;

// Инструменты старосты: кто опаздывает, досье группы и объявления с напоминанием.
export const HeadmanScreen = ({ onOpenProfile, onOpenStudent }: { onOpenProfile: () => void; onOpenStudent: (id: number) => void }) => {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>('late');
  return (
    <div className="screen screen--tabbed screen--headman">
      <TopBar
        onOpenProfile={onOpenProfile}
        left={(
          <div className="segment" role="tablist" aria-label={t.tabHeadman}>
            <button type="button" role="tab" aria-selected={section === 'late'} onClick={() => setSection('late')}>{t.lateSection}</button>
            <button type="button" role="tab" aria-selected={section === 'news'} onClick={() => setSection('news')}>{t.newsSection}</button>
          </div>
        )}
      />
      {section === 'late' ? <Lateness onOpenStudent={onOpenStudent} /> : <News />}
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

  return (
    <>
      <div className="block-head block-head--row">
        <h1 className="block-title">{offset === 0 ? t.lateTodayTitle : t.lateYesterdayTitle}</h1>
        <div className="segment segment--small" role="tablist">
          <button type="button" role="tab" aria-selected={offset === -1} onClick={() => setOffset(-1)}>{t.yesterday}</button>
          <button type="button" role="tab" aria-selected={offset === 0} onClick={() => setOffset(0)}>{t.today}</button>
        </div>
      </div>
      {!notes && !error && <Loading />}
      {error && <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {notes && notes.length === 0 && <Empty title={t.allHere}>{t.allHereText}</Empty>}
      {notes && notes.length > 0 && (
        <div className="stat-row">
          <div className="stat"><span className="stat__value">{late.length}</span><span className="stat__label">{t.statLate}</span></div>
          <div className="stat"><span className="stat__value">{absent.length}</span><span className="stat__label">{t.statAbsent}</span></div>
        </div>
      )}
      {notes && notes.length > 0 && (
        <div className="notes">{notes.map((note) => <NoteRow key={note.id} note={note} withName />)}</div>
      )}

      <div className="block-head">
        <h2 className="block-title">{t.dossierTitle}</h2>
        <p className="block-note">{t.dossierHint}</p>
      </div>
      {!students && <Loading />}
      {students && students.length === 0 && <Empty title={t.dossierEmpty} />}
      {students && students.length > 0 && <StudentList students={students} onOpen={onOpenStudent} />}
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
        <h1 className="block-title">{t.newAnnouncement}</h1>
        <p className="block-note">{t.newAnnouncementHint}</p>
      </div>
      <div className="composer">
        <div className="editor">
          <Textarea rows={4} maxLength={MAX_TEXT} placeholder={t.announcementPlaceholder} value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <p className="field-label">{t.remindGroup}</p>
        <ReminderPicker value={remindAt} onChange={setRemindAt} now={now} />
        <div className="actions">
          <Button stretched size="large" disabled={!text.trim()} loading={sending} onClick={publish}>{t.publish}</Button>
        </div>
        {notice && <p className={`toast toast--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      </div>

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
                {item.remindAt && <span className="task__bell"><BellIcon size={14} /> {formatMoment(item.remindAt)}</span>}
              </span>
              <span className="task__text task__text--full">{item.text}</span>
              {item.mine && (
                <button type="button" className={`text-button text-button--danger${confirm === item.id ? ' is-confirm' : ''}`} onClick={() => remove(item.id)}>
                  <TrashIcon size={16} /> {confirm === item.id ? t.confirmRemove : t.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
