import { useState } from 'react';
import { Button, Textarea } from '@maxhub/max-ui';
import type { Lesson } from '../data/schedule';
import { ApiError, sendAbsence, type AbsenceKind } from '../lib/api';
import { haptic } from '../bridge/max';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import { Sheet } from './Sheet';

const REASONS: Record<AbsenceKind, string[]> = {
  late: ['transport', 'late10', 'late20'],
  absent: ['ill', 'family', 'certificate'],
};
const MINUTES = [5, 10, 15, 20, 30, 45];
const MAX_TEXT = 500;

type Props = {
  kind: AbsenceKind;
  lesson?: Lesson;
  onClose: () => void;
  onSent?: () => void;
};

type Result = { tone: 'ok' | 'error'; text: string };

// Опоздание: сначала на сколько, потом причина кнопкой или своими словами. Отсутствие: сразу причина.
export const AbsenceSheet = ({ kind, lesson, onClose, onSent }: Props) => {
  const { t } = useI18n();
  const { me } = useMe();
  const [minutes, setMinutes] = useState<number | null>(kind === 'late' ? 10 : null);
  const [own, setOwn] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const toDeputy = me?.role === 'headman';

  const submit = async (reason: string | null) => {
    if (sending) return;
    setSending(reason ?? 'own');
    setResult(null);
    try {
      const { status } = await sendAbsence({
        kind,
        ...(reason ? { reason } : { text: text.trim() }),
        ...(kind === 'late' && minutes ? { minutes } : {}),
        ...(lesson ? { lessonDate: lesson.date, lessonNumber: lesson.lessonNumber } : {}),
      });
      haptic.success();
      setResult({ tone: 'ok', text: status === 'pending' ? t.absencePending : toDeputy && me?.deputy ? t.absenceSentTo(me.deputy.name) : t.absenceSent });
      onSent?.();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      const message = code === 'no_headman' ? t.noHeadman : code === 'no_deputy' ? t.noDeputy : (error as Error).message;
      setResult({ tone: 'error', text: message });
    } finally {
      setSending(null);
    }
  };

  const done = result?.tone === 'ok';

  return (
    <Sheet
      title={t.absenceTitle(kind)}
      labelId="absence-title"
      onClose={onClose}
      busy={Boolean(sending)}
      hint={<>{lesson ? `${lesson.subject}, ${lesson.time.slice(0, 5)}. ` : ''}{toDeputy ? t.absenceHintDeputy(me?.deputy?.name ?? null) : t.absenceHint}</>}
    >
      {!done && kind === 'late' && (
        <>
          <p className="field-label">{t.lateBy}</p>
          <div className="chips" role="radiogroup" aria-label={t.lateBy}>
            {MINUTES.map((value) => (
              <button key={value} type="button" role="radio" className="chip-option" aria-checked={minutes === value} onClick={() => setMinutes(value)}>
                {t.minutesShort(value)}
              </button>
            ))}
          </div>
        </>
      )}

      {!done && !own && (
        <>
          <p className="field-label">{t.reason}</p>
          <div className="sheet__options">
            {REASONS[kind].filter((reason) => kind !== 'late' || reason === 'transport').map((reason) => (
              <Button key={reason} stretched size="large" variant="secondary" loading={sending === reason} disabled={Boolean(sending)} onClick={() => submit(reason)}>
                {t.absenceReasons[reason]}
              </Button>
            ))}
            {kind === 'late' && (
              <Button stretched size="large" variant="secondary" loading={sending === 'late10'} disabled={Boolean(sending)} onClick={() => submit('late10')}>
                {t.justLate}
              </Button>
            )}
            <Button stretched size="large" variant="ghost" disabled={Boolean(sending)} onClick={() => setOwn(true)}>
              {t.ownReason}…
            </Button>
          </div>
        </>
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
              {toDeputy ? t.sendDeputy : t.send}
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
          <Button stretched size="large" onClick={onClose}>{t.done}</Button>
        </div>
      )}
    </Sheet>
  );
};
