import { useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { saveAnnouncementReminder, type Announcement } from '../lib/api';
import { formatMoment } from '../lib/date';
import { useI18n } from '../lib/i18n';
import { haptic } from '../bridge/max';
import { ReminderPicker } from './ReminderPicker';
import { Sheet } from './Sheet';

type Props = { item: Announcement; now: Date; onClose: () => void; onSaved: (item: Announcement) => void };

// Объявление старосты: текст и своё время напоминания. Время старосты можно вернуть одной кнопкой.
export const AnnouncementSheet = ({ item, now, onClose, onSaved }: Props) => {
  const { t } = useI18n();
  const [value, setValue] = useState<string | null>(item.myRemindAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value !== item.myRemindAt;

  const save = async (body: { remindAt: string | null } | { reset: true }) => {
    setSaving(true);
    setError(null);
    try {
      const { item: saved } = await saveAnnouncementReminder(item.id, body);
      haptic.success();
      onSaved(saved);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={t.announcementTitle} labelId="announcement-title" onClose={onClose} busy={saving}
      hint={[item.authorName, formatMoment(item.createdAt)].filter(Boolean).join(' · ')}>
      <p className="announcement-text">{item.text}</p>
      <p className="field-label">{t.myReminder}</p>
      {item.remindAt && <p className="sheet__hint">{t.headmanReminder(formatMoment(item.remindAt))}</p>}
      <ReminderPicker value={value} onChange={setValue} now={now} />
      {error && <p className="toast toast--error" role="alert">{error}</p>}
      <div className="actions">
        <Button stretched size="large" disabled={!changed} loading={saving} onClick={() => save({ remindAt: value })}>{t.save}</Button>
        {item.customized && item.remindAt && (
          <Button stretched variant="ghost" disabled={saving} onClick={() => save({ reset: true })}>{t.remindLikeHeadman}</Button>
        )}
      </div>
    </Sheet>
  );
};
