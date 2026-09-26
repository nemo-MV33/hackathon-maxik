import { useState } from 'react';
import { Button } from '@maxhub/max-ui';
import { loadWeek, loadGroups, type Group } from '../data/schedule';
import { saveHomework } from '../data/homework';
import { haptic } from '../bridge/max';
import { syncProfile } from '../lib/api';
import { type SharedHomework } from '../lib/homework';
import { formatDay, fromDateKey, startOfWeek, toDateKey } from '../lib/date';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { Empty, ErrorState, Loading } from '../components/Status';
import { Wordmark } from '../components/Wordmark';
import { useI18n } from '../lib/i18n';

const findContext = async (shared: SharedHomework) => {
  const [groups, week] = await Promise.all([
    loadGroups(),
    loadWeek(shared.groupId, toDateKey(startOfWeek(fromDateKey(shared.date)))).catch(() => null),
  ]);
  const group = groups.find((item) => item.id === shared.groupId);
  const lesson = week?.lessons.find((item) =>
    item.date === shared.date && item.lessonNumber === shared.lessonNumber
    && (item.subgroup ?? null) === shared.subgroup);
  return { group, lesson };
};

export const ImportScreen = ({ shared, profile, onDone }: {
  shared: SharedHomework | null;
  profile: LocalProfile | null;
  onDone: (group?: Group) => void;
}) => {
  const { t } = useI18n();
  const [context, retry] = useAsync(() => (shared ? findContext(shared) : Promise.resolve(null)), [shared]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!shared) {
    return (
      <div className="screen">
        <Wordmark />
        <Empty title={t.brokenLinkTitle}>{t.brokenLinkText}</Empty>
        <Button stretched size="large" onClick={() => onDone()}>{t.openSchedule}</Button>
      </div>
    );
  }
  if (context.status === 'loading') return <Loading label={t.findingLesson} />;
  if (context.status === 'error') return <div className="screen"><ErrorState message={context.message} onRetry={retry} /></div>;

  const { group, lesson } = context.data ?? {};
  const subject = lesson?.subject ?? t.pair(shared.lessonNumber);
  const otherGroup = profile && group && profile.group.id !== shared.groupId;

  const accept = async () => {
    if (!group || !lesson || saving) return;
    setSaving(true);
    setSaveError(null);
    let switched = false;
    try {
      await syncProfile(group.id, shared.subgroup);
      switched = true;
      await saveHomework(lesson, shared.text, 'personal');
      haptic.success();
      onDone(group);
    } catch (error) {
      if (switched && profile) {
        await syncProfile(profile.group.id, profile.subgroup).catch(() => {});
      }
      setSaveError((error as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <div className="intro">
        <p className="eyebrow">{t.sharedWithYou}</p>
        <h1 className="display">{subject}</h1>
      </div>
      <dl className="facts">
        <div><dt>{t.groupField}</dt><dd>{group?.title ?? t.groupNotFound}{shared.subgroup ? `, ${t.subgroup(shared.subgroup)}` : ''}</dd></div>
        <div><dt>{t.when}</dt><dd className="first-letter">{formatDay(fromDateKey(shared.date))}{lesson ? <> · <span className="mono">{lesson.time}</span></> : ''}</dd></div>
      </dl>
      <div className="hw-block hw-block--quote">
        <p className="hw-block__label">{t.task}</p>
        <p className="hw-block__text">{shared.text}</p>
      </div>
      {otherGroup && (
        <p className="callout">
          {t.otherGroupWarning(group.title, profile.group.title)}
        </p>
      )}
      {!lesson && <p className="callout callout--error">{t.lessonMissing}</p>}
      {saveError && <p className="callout callout--error" role="alert">{saveError}</p>}
      <div className="actions">
        <Button stretched size="large" disabled={!group || !lesson} loading={saving} onClick={accept}>{t.saveForMe}</Button>
        <Button stretched variant="ghost" disabled={saving} onClick={() => onDone()}>{t.dontSave}</Button>
      </div>
    </div>
  );
};
