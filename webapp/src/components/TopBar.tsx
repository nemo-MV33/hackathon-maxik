import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';
import { currentUser } from '../bridge/max';

type Props = { left: ReactNode; onOpenProfile: () => void; extra?: ReactNode };

// Шапка вкладок: слева — то, что относится к экрану, справа — вход в профиль (аватар с инициалом).
export const TopBar = ({ left, onOpenProfile, extra }: Props) => {
  const { t } = useI18n();
  const { me } = useMe();
  const user = currentUser();
  const name = me?.user.firstName ?? user?.first_name ?? me?.user.username ?? '';
  return (
    <header className="topbar">
      <div className="topbar__left">{left}</div>
      <div className="topbar__right">
        {extra}
        <button type="button" className="avatar-button" aria-label={t.profile} onClick={onOpenProfile}>
          {name ? name.slice(0, 1).toUpperCase() : '·'}
        </button>
      </div>
    </header>
  );
};

