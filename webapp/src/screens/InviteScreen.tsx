import { Button } from '@maxhub/max-ui';
import { loadGroups, type Group } from '../data/schedule';
import { useAsync } from '../lib/useAsync';
import { useI18n } from '../lib/i18n';
import { ErrorState, Loading } from '../components/Status';

type Props = {
  groupId: number;
  subgroup: 1 | 2 | null;
  onAccept: (group: Group, subgroup: 1 | 2 | null) => void;
  onOther: () => void;
};

export const InviteScreen = ({ groupId, subgroup, onAccept, onOther }: Props) => {
  const { t } = useI18n();
  const [groups, retry] = useAsync(loadGroups, []);
  if (groups.status === 'loading') return <Loading />;
  if (groups.status === 'error') return <div className="screen"><ErrorState message={groups.message} onRetry={retry} /></div>;
  const group = groups.data.find((item) => item.id === groupId);
  if (!group) {
    return (
      <div className="screen">
        <ErrorState message={t.brokenLinkText} />
        <Button stretched size="large" onClick={onOther}>{t.invitedOther}</Button>
      </div>
    );
  }
  return (
    <div className="screen screen--welcome">
      <header className="intro">
        <p className="eyebrow">{t.invitedTitle}</p>
        <h1 className="display">{group.title}</h1>
        <p className="lead">{t.invitedText(group.title, subgroup ? t.subgroup(subgroup) : t.wholeGroup)}</p>
      </header>
      <div className="actions">
        <Button stretched size="large" onClick={() => onAccept(group, subgroup)}>{t.invitedYes}</Button>
        <Button stretched variant="ghost" onClick={onOther}>{t.invitedOther}</Button>
      </div>
    </div>
  );
};
