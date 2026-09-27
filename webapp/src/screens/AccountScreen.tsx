import { currentUser } from '../bridge/max';
import type { LocalProfile } from '../lib/profile';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import { BackHeader } from '../components/BackHeader';
import { Loading } from '../components/Status';

// Аккаунт: только чтение. Имя приходит из MAX, группа — из выбора в разделе «Университет».
export const AccountScreen = ({ profile, onBack }: { profile: LocalProfile; onBack: () => void }) => {
  const { t } = useI18n();
  const { me } = useMe();
  const user = currentUser();
  const rows: [string, string][] = [
    [t.fieldName, [me?.user.firstName ?? user?.first_name, me?.user.lastName ?? user?.last_name].filter(Boolean).join(' ') || '—'],
    [t.fieldUsername, me?.user.username ?? user?.username ? `@${me?.user.username ?? user?.username}` : '—'],
    [t.fieldMaxId, String(me?.user.id ?? user?.id ?? '—')],
    [t.fieldUniversity, t.universityName],
    [t.fieldInstitute, profile.group.institute || me?.profile.institute || '—'],
    [t.fieldCourse, profile.group.course ? t.course(profile.group.course) : '—'],
    [t.fieldGroup, profile.group.title],
    [t.fieldSubgroup, profile.subgroup ? t.subgroup(profile.subgroup) : t.wholeGroup],
    [t.fieldRole, me ? t.roleNames[me.role] : '—'],
    [t.fieldHeadman, me?.headman?.name ?? t.notAssigned],
  ];
  return (
    <div className="screen screen--section">
      <BackHeader label={t.profile} onBack={onBack} title={t.account} />
      <p className="lead">{t.accountLead}</p>
      {!me && <Loading />}
      <dl className="facts facts--wide">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="hint">{t.accountPrivacy}</p>
    </div>
  );
};
