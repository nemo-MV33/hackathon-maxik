import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/me';

type Props = { currentGroup: string; onSwitch: (groupId: string) => Promise<void> };

// Роль старосты или редактора выдана в чате другой группы: объясняем и даём перейти в одно касание.
export const RoleElsewhere = ({ currentGroup, onSwitch }: Props) => {
  const { t } = useI18n();
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const other = me && me.role === 'student' ? me.otherRoles?.find((item) => item.role === 'headman') ?? me.otherRoles?.[0] : undefined;
  if (!other) return null;
  return (
    <div className="callout-card callout-card--warn">
      <p className="callout-card__title">{t.roleElsewhereTitle(other.role, other.group.title)}</p>
      <p className="callout-card__text">{t.roleElsewhereText(currentGroup, other.chatTitle)}</p>
      <button type="button" className="text-button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await onSwitch(other.group.id); } finally { setBusy(false); }
      }}>{t.roleElsewhereSwitch(other.group.title)}</button>
    </div>
  );
};
