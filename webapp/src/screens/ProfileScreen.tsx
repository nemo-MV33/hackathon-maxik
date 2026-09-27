import { useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { currentUser, haptic, miniAppLink, shareText } from '../bridge/max';
import { deleteAccount } from '../lib/api';
import type { LocalProfile } from '../lib/profile';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import { BackHeader } from '../components/BackHeader';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { Sheet } from '../components/Sheet';
import {
  BellIcon, BookIcon, ChevronRight, GlobeIcon, HelpIcon, IdIcon, PaletteIcon, RunIcon, SchoolIcon, ShareIcon, TrashIcon,
} from '../components/Icon';

export type ProfileSection = 'account' | 'university' | 'disciplines' | 'notifications' | 'absences' | 'faq';

type Props = {
  profile: LocalProfile;
  onBack: () => void;
  onOpen: (section: ProfileSection) => void;
  onAccountDeleted: () => void;
};

type RowProps = { icon: React.ReactNode; title: string; hint?: string; onClick: () => void };
const Row = ({ icon, title, hint, onClick }: RowProps) => (
  <button type="button" className="settings-row" onClick={onClick}>
    <span className="settings-row__icon">{icon}</span>
    <span className="settings-row__text">
      <span className="settings-row__title">{title}</span>
      {hint && <span className="settings-row__hint">{hint}</span>}
    </span>
    <ChevronRight size={18} />
  </button>
);

// Профиль — оглавление: сначала учёба (самое частое), потом настройки, внизу справка и удаление аккаунта.
export const ProfileScreen = ({ profile, onBack, onOpen, onAccountDeleted }: Props) => {
  const { t } = useI18n();
  const { me } = useMe();
  const user = currentUser();
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const name = [me?.user.firstName ?? user?.first_name, me?.user.lastName ?? user?.last_name].filter(Boolean).join(' ')
    || me?.user.username || user?.username || t.profile;
  const username = me?.user.username ?? user?.username;
  const settings = me?.profile;
  const notifyHint = !settings ? undefined : settings.muted ? t.notifyAllOff : t.notifyHintOn(settings.reminderMinutes, settings.summaryTime);

  const invite = async () => {
    const link = miniAppLink(`group_${profile.group.id}_${profile.subgroup ?? 0}`);
    const result = await shareText(t.inviteText(profile.group.title), link);
    if (result.status === 'copied') setInviteNotice(t.inviteCopied);
    else if (result.status === 'manual') setInviteNotice(link);
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      haptic.success();
      try { localStorage.clear(); } catch {}
      onAccountDeleted();
    } catch (failure) {
      setDeleteError((failure as Error).message);
      setDeleting(false);
    }
  };

  return (
    <div className="screen screen--profile">
      <BackHeader label={t.back} onBack={onBack} />

      <header className="profile-head">
        <span className="profile-head__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div className="profile-head__text">
          <h1 className="profile-head__name">{name}</h1>
          <p className="profile-head__meta">
            {[username && `@${username}`, profile.group.title].filter(Boolean).join(' · ')}
          </p>
          {me && me.role !== 'student' && <span className="role-badge">{t.roleNames[me.role]}</span>}
        </div>
      </header>

      <section className="settings" aria-label={t.studySection}>
        <p className="settings__label">{t.studySection}</p>
        <div className="settings-list">
          <Row icon={<SchoolIcon />} title={t.university} hint={`${profile.group.title} · ${profile.subgroup ? t.subgroup(profile.subgroup) : t.wholeGroup}`} onClick={() => onOpen('university')} />
          <Row icon={<BookIcon />} title={t.disciplines} hint={t.disciplinesHint} onClick={() => onOpen('disciplines')} />
          <Row icon={<RunIcon />} title={t.absencesSection} hint={me?.role === 'headman' ? t.absencesHintHeadman : t.absencesHint} onClick={() => onOpen('absences')} />
        </div>
      </section>

      <section className="settings" aria-label={t.settingsSection}>
        <p className="settings__label">{t.settingsSection}</p>
        <div className="settings-list">
          <Row icon={<BellIcon size={20} />} title={t.notificationsTitle} hint={notifyHint} onClick={() => onOpen('notifications')} />
          <div className="settings-row settings-row--static">
            <span className="settings-row__icon"><GlobeIcon /></span>
            <span className="settings-row__text"><span className="settings-row__title">{t.profileLanguage}</span></span>
            <LanguageSwitch />
          </div>
          <div className="settings-row settings-row--static settings-row--wrap">
            <span className="settings-row__icon"><PaletteIcon /></span>
            <span className="settings-row__text"><span className="settings-row__title">{t.theme}</span></span>
            <ThemeSwitch />
          </div>
        </div>
      </section>

      <section className="settings" aria-label={t.accountSection}>
        <p className="settings__label">{t.accountSection}</p>
        <div className="settings-list">
          <Row icon={<IdIcon />} title={t.account} hint={t.accountHint} onClick={() => onOpen('account')} />
          <Row icon={<ShareIcon />} title={t.invite} onClick={invite} />
          <Row icon={<HelpIcon />} title={t.faq} hint={t.faqHint} onClick={() => onOpen('faq')} />
        </div>
        {inviteNotice && <p className="toast" role="status">{inviteNotice}</p>}
      </section>

      <button type="button" className="danger-button" onClick={() => setConfirmDelete(true)}>
        <TrashIcon size={18} /> {t.deleteAccount}
      </button>
      <p className="footnote">{t.deleteFootnote}</p>

      {confirmDelete && (
        <Sheet title={t.deleteTitle} labelId="delete-title" onClose={() => setConfirmDelete(false)} busy={deleting} hint={me?.role === 'headman' ? t.deleteHintHeadman : t.deleteHint}>
          {deleteError && <p className="toast toast--error" role="alert">{deleteError}</p>}
          <div className="actions">
            <Button stretched size="large" variant="destructive" loading={deleting} onClick={remove}>{t.deleteYes}</Button>
            <Button stretched variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>{t.cancel}</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
};
