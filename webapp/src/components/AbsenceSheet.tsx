import { useEffect, useState } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { ApiError, sendAbsence, type AbsenceKind } from '../lib/api';
import { haptic } from '../bridge/max';
import { useI18n } from '../lib/i18n';

const REASONS: Record<AbsenceKind, string[]> = {
  late: ['late10', 'late20', 'transport'],
  absent: ['ill', 'family', 'certificate'],
};
const MAX_TEXT = 500;

type Props = {
  kind: AbsenceKind;
  lesson?: Lesson;
  onClose: () => void;
};

type Result = { tone: 'ok' | 'error'; text: string };

export const AbsenceSheet = ({ kind, lesson, onClose }: Props) => {
  const { t } = useI18n();
  const [own, setOwn] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const submit = async (reason: string | null) => {
    if (sending) return;
    setSending(reason ?? 'own');
    setResult(null);
    try {
      const { status } = await sendAbsence({
        kind,
        ...(reason ? { reason } : { text: text.trim() }),
        ...(lesson ? { lessonDate: lesson.date, lessonNumber: lesson.lessonNumber } : {}),
      });
      haptic.success();
      setResult({ tone: 'ok', text: status === 'pending' ? t.absencePending : t.absenceSent });
    } catch (error) {
      const message = error instanceof ApiError && error.code === 'no_headman' ? t.noHeadman : (error as Error).message;
      setResult({ tone: 'error', text: message });
    } finally {
      setSending(null);
    }
  };

  const done = result?.tone === 'ok';

  return (
    <div className="sheet-backdrop" onClick={() => !sending && onClose()}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="absence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sheet__grip" aria-hidden="true" />
        <h2 id="absence-title" className="sheet__title">{t.absenceTitle(kind)}</h2>
        <p className="sheet__hint">
          {lesson ? `${lesson.subject} · ${lesson.time.slice(0, 5)}. ` : ''}{t.absenceHint}
        </p>

        {!done && !own && (
          <div className="sheet__options">
            {REASONS[kind].map((reason) => (
              <Button
                key={reason}
                stretched
                size="large"
                variant="secondary"
                loading={sending === reason}
                disabled={Boolean(sending)}
                onClick={() => submit(reason)}
              >
                {t.absenceReasons[reason]}
              </Button>
            ))}
            <Button stretched size="large" variant="ghost" disabled={Boolean(sending)} onClick={() => setOwn(true)}>
              {t.ownReason}…
            </Button>
          </div>
        )}

        {!done && own && (
          <div className="editor">
            <Textarea
              autoFocus
              rows={3}
              maxLength={MAX_TEXT}
              placeholder={t.ownReasonPlaceholder}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="sheet__hint">{t.photoInBot}</p>
            <div className="actions">
              <Button stretched size="large" disabled={!text.trim()} loading={sending === 'own'} onClick={() => submit(null)}>
                {t.send}
              </Button>
              <Button stretched variant="ghost" disabled={Boolean(sending)} onClick={() => setOwn(false)}>{t.cancel}</Button>
            </div>
          </div>
        )}

        {result && (
          <p className={`toast toast--${result.tone}`} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</p>
        )}
        {done && (
          <div className="actions">
            <Button stretched size="large" onClick={onClose}>OK</Button>
          </div>
        )}
      </div>
    </div>
  );
};
