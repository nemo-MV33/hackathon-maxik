import { useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { updateSettings } from '../lib/api';
import { haptic } from '../bridge/max';
import { useI18n } from '../lib/i18n';

type Props = {
  groupTitle: string;
  onDone: (next: 'schedule' | 'profile') => void;
};

const ALL_ON = { summary: true, homework: true, changes: true, exams: true };
const ALL_OFF = { summary: false, homework: false, changes: false, exams: false };

// Первое знакомство: что умеет приложение и какие уведомления включить. Флаг onboarded общий с ботом.
export const WelcomeScreen = ({ groupTitle, onDone }: Props) => {
  const { t } = useI18n();
  const [saving, setSaving] = useState<string | null>(null);

  const finish = async (choice: 'all' | 'pick' | 'none') => {
    setSaving(choice);
    const patch = choice === 'pick'
      ? { onboarded: true }
      : { onboarded: true, remindersEnabled: choice === 'all', notifications: choice === 'all' ? ALL_ON : ALL_OFF };
    await updateSettings(patch).catch(() => {});
    haptic.success();
    onDone(choice === 'pick' ? 'profile' : 'schedule');
  };

  const features: [string, string, string][] = [
    ['01', t.welcomeSchedule, t.welcomeScheduleText],
    ['02', t.welcomeHomework, t.welcomeHomeworkText],
    ['03', t.welcomeAbsence, t.welcomeAbsenceText],
  ];

  return (
    <div className="screen screen--welcome">
      <header className="intro">
        <p className="eyebrow">{t.welcomeLead}</p>
        <h1 className="display">{t.welcomeTitle(groupTitle)}</h1>
      </header>
      <div className="welcome-list">
        {features.map(([number, title, text]) => (
          <div key={number} className="welcome-item">
            <span className="welcome-item__number">{number}</span>
            <span className="welcome-item__text">
              <span className="welcome-item__title">{title}</span>
              <span className="welcome-item__hint">{text}</span>
            </span>
          </div>
        ))}
      </div>
      <section className="hw-block">
        <p className="section-title welcome-notify__title">{t.welcomeNotifyTitle}</p>
        <p className="hint">{t.welcomeNotifyText}</p>
        <div className="actions">
          <Button stretched size="large" loading={saving === 'all'} disabled={Boolean(saving)} onClick={() => finish('all')}>{t.welcomeAll}</Button>
          <Button stretched size="large" variant="secondary" loading={saving === 'pick'} disabled={Boolean(saving)} onClick={() => finish('pick')}>{t.welcomePick}</Button>
          <Button stretched variant="ghost" disabled={Boolean(saving)} onClick={() => finish('none')}>{t.welcomeLater}</Button>
        </div>
      </section>
    </div>
  );
};
