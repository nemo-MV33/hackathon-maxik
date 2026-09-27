import { useState } from 'react';
import { Switch } from '@maxhub/max-ui';
import type { Notifications, SettingsPatch } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import { haptic } from '../bridge/max';
import { BackHeader } from '../components/BackHeader';
import { ErrorState, Loading } from '../components/Status';
import { ChevronDown } from '../components/Icon';

const REMINDER = [5, 10, 15, 30];
const END = [5, 10];
const SUMMARY = Array.from({ length: 16 }, (_, index) => `${String(16 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
type Kind = keyof Notifications;
const SIMPLE: Kind[] = ['homework', 'announcements', 'changes', 'exams'];

// Уведомления общие с ботом: всё, что меняется здесь, сразу действует и в чате.
export const NotificationsScreen = ({ onBack }: { onBack: () => void }) => {
  const { t } = useI18n();
  const { me, error, refresh, update } = useMe();
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const settings = me?.profile;

  const save = async (key: string, patch: SettingsPatch) => {
    setSaving(key);
    setFailure(null);
    try {
      await update(patch);
      haptic.tap();
    } catch (reason) {
      setFailure((reason as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (!settings) {
    return (
      <div className="screen screen--section">
        <BackHeader label={t.profile} onBack={onBack} title={t.notificationsTitle} />
        {error ? <ErrorState message={error} onRetry={refresh} /> : <Loading />}
      </div>
    );
  }

  const muted = settings.muted;
  const toggle = (kind: Kind) => save(kind, { notifications: { [kind]: !settings.notifications[kind] } });

  return (
    <div className="screen screen--section">
      <BackHeader label={t.profile} onBack={onBack} title={t.notificationsTitle} />
      <p className="lead">{t.notificationsLead}</p>

      <div className="settings-list">
        <label className="settings-row settings-row--static">
          <span className="settings-row__text">
            <span className="settings-row__title">{t.notifyAll}</span>
            <span className="settings-row__hint">{muted ? t.notifyAllOff : t.notifyAllOn}</span>
          </span>
          <Switch checked={!muted} disabled={saving === 'muted'} onChange={() => save('muted', { muted: !muted })} />
        </label>
      </div>

      <fieldset className="settings-group" disabled={muted}>
        <p className="settings__label">{t.aboutLessons}</p>
        <div className="settings-list">
          <label className="settings-row settings-row--static">
            <span className="settings-row__text">
              <span className="settings-row__title">{t.notifyBeforeStart}</span>
              <span className="settings-row__hint">{t.notifyBeforeStartHint}</span>
            </span>
            <Switch checked={settings.remindersEnabled} disabled={muted || saving === 'reminders'} onChange={() => save('reminders', { remindersEnabled: !settings.remindersEnabled })} />
          </label>
          {settings.remindersEnabled && (
            <div className="settings-row settings-row--static settings-row--sub">
              <span className="settings-row__hint">{t.minutesBefore}</span>
              <div className="lang-switch" role="radiogroup" aria-label={t.minutesBefore}>
                {REMINDER.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={settings.reminderMinutes === value} onClick={() => save('rm', { reminderMinutes: value })}>{value}</button>
                ))}
              </div>
            </div>
          )}
          <label className="settings-row settings-row--static">
            <span className="settings-row__text">
              <span className="settings-row__title">{t.notifyBeforeEnd}</span>
              <span className="settings-row__hint">{t.notifyBeforeEndHint}</span>
            </span>
            <Switch checked={settings.notifications.lessonEnd} disabled={muted || saving === 'lessonEnd'} onChange={() => toggle('lessonEnd')} />
          </label>
          {settings.notifications.lessonEnd && (
            <div className="settings-row settings-row--static settings-row--sub">
              <span className="settings-row__hint">{t.minutesBeforeEnd}</span>
              <div className="lang-switch" role="radiogroup" aria-label={t.minutesBeforeEnd}>
                {END.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={settings.endMinutes === value} onClick={() => save('em', { endMinutes: value })}>{value}</button>
                ))}
              </div>
            </div>
          )}
          <label className="settings-row settings-row--static">
            <span className="settings-row__text">
              <span className="settings-row__title">{t.notifySummary}</span>
              <span className="settings-row__hint">{t.notifySummaryHint}</span>
            </span>
            <Switch checked={settings.notifications.summary} disabled={muted || saving === 'summary'} onChange={() => toggle('summary')} />
          </label>
          {settings.notifications.summary && (
            <div className="settings-row settings-row--static settings-row--sub">
              <span className="settings-row__hint">{t.summaryAt}</span>
              <span className="select-field__box select-field__box--inline">
                <select value={settings.summaryTime} disabled={muted} onChange={(event) => save('st', { summaryTime: event.target.value })} aria-label={t.summaryAt}>
                  {SUMMARY.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <ChevronDown size={16} />
              </span>
            </div>
          )}
        </div>

        <p className="settings__label">{t.aboutGroup}</p>
        <div className="settings-list">
          {SIMPLE.map((kind) => (
            <label key={kind} className="settings-row settings-row--static">
              <span className="settings-row__text">
                <span className="settings-row__title">{t.notifyTitles[kind]}</span>
                <span className="settings-row__hint">{t.notifyHints[kind]}</span>
              </span>
              <Switch checked={settings.notifications[kind]} disabled={muted || saving === kind} onChange={() => toggle(kind)} />
            </label>
          ))}
        </div>
      </fieldset>
      {failure && <p className="toast toast--error" role="alert">{failure}</p>}
      <p className="hint">{t.notificationsFootnote}</p>
    </div>
  );
};
