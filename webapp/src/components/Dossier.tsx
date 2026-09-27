import type { AbsenceNote, StudentSummary } from '../lib/api';
import { formatDuration, formatStamp } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { ChevronRight } from './Icon';

// Код причины «опоздаю на 5–10 минут» устарел: минуты теперь указываются отдельно.
export const useReasonLabel = () => {
  const { t } = useI18n();
  return (note: AbsenceNote) => {
    const reason = note.reason && !['late10', 'late20'].includes(note.reason) ? t.absenceReasons[note.reason] : null;
    return [reason, note.text].filter(Boolean).join(' — ') || (note.kind === 'late' ? t.justLate : t.absentNoReason);
  };
};

export const NoteRow = ({ note, withName = false }: { note: AbsenceNote; withName?: boolean }) => {
  const { t } = useI18n();
  const reason = useReasonLabel();
  return (
    <div className="note-row">
      <span className={`note-row__badge note-row__badge--${note.kind}`}>
        {note.kind === 'late' ? `+${note.minutes ?? '?'} ${t.minutes}` : t.missed}
      </span>
      <span className="note-row__text">
        <span className="note-row__title">{withName && note.senderName ? note.senderName : t.lateKind(note.kind)}</span>
        <span className="note-row__hint">
          {[note.lesson && `${note.lesson.time.slice(0, 5)} · ${note.lesson.subject}`, reason(note)].filter(Boolean).join(' · ')}
        </span>
        <span className="note-row__meta">
          {formatStamp(note.createdAt)}
          <span className={`status-pill status-pill--small${note.acceptedAt ? ' is-ok' : ''}`}>{note.acceptedAt ? t.accepted : t.waiting}</span>
        </span>
      </span>
    </div>
  );
};

export const StudentList = ({ students, onOpen }: { students: StudentSummary[]; onOpen: (id: number) => void }) => {
  const { t } = useI18n();
  return (
    <div className="settings-list">
      {students.map((student) => (
        <button key={student.id} type="button" className="settings-row" onClick={() => onOpen(student.id)}>
          <span className="settings-row__text">
            <span className="settings-row__title">{student.name}</span>
            <span className="settings-row__hint">{t.dossierCounts(student.late, student.absent)}</span>
          </span>
          <span className="dossier-total">{formatDuration(student.totalMinutes)}</span>
          <ChevronRight size={18} />
        </button>
      ))}
    </div>
  );
};
