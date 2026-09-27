import { useEffect, useState } from 'react';
import { Switch } from '@maxhub/max-ui';
import { currentUser, hasNativeBackButton, haptic } from '../bridge/max';
import { loadMe, updateSettings, type Notifications, type RemoteProfile } from '../lib/api';
import type { LocalProfile } from '../lib/profile';
import { useBackButton } from '../lib/useBackButton';
import { useI18n } from '../lib/i18n';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ChevronLeft, ChevronRight } from '../components/Icon';
import { ErrorState, Loading } from '../components/Status';

type Props = {
  profile: LocalProfile;
  onChangeGroup: () => void;
  onBack: () => void;
};

type Settings = Pick<RemoteProfile, 'remindersEnabled' | 'notifications'>;
type SettingKey = 'reminders' | keyof Notifications;

const SETTINGS: SettingKey[] = ['reminders', 'summary', 'homework', 'changes'];

// Заготовка профиля: шапка и группа. Раздел «Уведомления» рабочий — настройки общие с ботом.
export const ProfileScreen = ({ profile, onChangeGroup, onBack }: Props) => {
  const { t } = useI18n();
  const user = currentUser();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SettingKey | null>(null);
  const [attempt, setAttempt] = useState(0);

  useBackButton(onBack);

  useEffect(() => {
    let active = true;
    setError(null);
    loadMe()
      .then(({ profile: remote }) => active && setSettings({ remindersEnabled: remote.remindersEnabled, notifications: remote.notifications }))
      .catch((failure: Error) => active && setError(failure.message));
    return () => { active = false; };
  }, [attempt]);

  const labels: Record<SettingKey, [string, string]> = {
    reminders: [t.notifyReminders, t.notifyRemindersHint],
    summary: [t.notifySummary, t.notifySummaryHint],
    homework: [t.notifyHomework, t.notifyHomeworkHint],
    changes: [t.notifyChanges, t.notifyChangesHint],
  };

  const isOn = (key: SettingKey) => (key === 'reminders' ? settings!.remindersEnabled : settings!.notifications[key]);

  const toggle = async (key: SettingKey) => {
    if (!settings || saving) return;
    const next = !isOn(key);
    const previous = settings;
    setSettings(key === 'reminders'
      ? { ...settings, remindersEnabled: next }
      : { ...settings, notifications: { ...settings.notifications, [key]: next } });
    setSaving(key);
    try {
      const { profile: saved } = await updateSettings(key === 'reminders'
        ? { remindersEnabled: next }
        : { notifications: { [key]: next } });
      setSettings({ remindersEnabled: saved.remindersEnabled, notifications: saved.notifications });
      haptic.tap();
    } catch (failure) {
      setSettings(previous);
      setError((failure as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || t.profile;

  return (
    <div className="screen screen--profile">
      {!hasNativeBackButton() && (
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={18} />{t.scheduleBack}</button>
      )}

      <header className="profile-head">
        <span className="profile-head__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div className="profile-head__text">
          <h1 className="profile-head__name">{name}</h1>
          {user?.username && <p className="profile-head__meta">@{user.username}</p>}
        </div>
      </header>

      <section className="settings-list" aria-label={t.profile}>
        <button type="button" className="settings-row" onClick={onChangeGroup}>
          <span className="settings-row__text">
            <span className="settings-row__title">{t.profileGroup}</span>
            <span className="settings-row__hint">
              {profile.group.title} · {profile.subgroup ? t.subgroup(profile.subgroup) : t.wholeGroup}
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
        <div className="settings-row">
          <span className="settings-row__text"><span className="settings-row__title">{t.profileLanguage}</span></span>
          <LanguageSwitch />
        </div>
      </section>

      <section className="settings" aria-labelledby="notifications-title">
        <div className="section-head">
          <h2 id="notifications-title" className="section-title">{t.notificationsTitle}</h2>
          <p className="section-note">{t.notificationsHint}</p>
        </div>
        {!settings && !error && <Loading />}
        {!settings && error && <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />}
        {settings && (
          <div className="settings-list">
            {SETTINGS.map((key) => (
              <label key={key} className="settings-row">
                <span className="settings-row__text">
                  <span className="settings-row__title">{labels[key][0]}</span>
                  <span className="settings-row__hint">{labels[key][1]}</span>
                </span>
                <Switch checked={isOn(key)} disabled={saving === key} onChange={() => toggle(key)} />
              </label>
            ))}
          </div>
        )}
        {settings && error && <p className="toast toast--error" role="alert">{error}</p>}
      </section>
    </div>
  );
};
