import { useState } from 'react';
import type { LocalProfile } from '../lib/profile';
import { useI18n } from '../lib/i18n';
import { useProfile } from '../lib/profile';
import { haptic } from '../bridge/max';
import { BackHeader } from '../components/BackHeader';
import { ChevronRight } from '../components/Icon';

// Университет: здесь меняют группу и подгруппу (раньше это было в шапке расписания).
export const UniversityScreen = ({ profile, onBack, onChangeGroup }: { profile: LocalProfile; onBack: () => void; onChangeGroup: () => void }) => {
  const { t } = useI18n();
  const [, saveProfile] = useProfile();
  const [subgroup, setSubgroup] = useState(profile.subgroup);
  const choose = (value: 1 | 2 | null) => {
    haptic.tap();
    setSubgroup(value);
    saveProfile({ ...profile, subgroup: value });
  };
  return (
    <div className="screen screen--section">
      <BackHeader label={t.profile} onBack={onBack} title={t.university} />
      <div className="settings-list">
        <div className="settings-row settings-row--static">
          <span className="settings-row__text">
            <span className="settings-row__hint">{t.fieldUniversity}</span>
            <span className="settings-row__title">{t.universityName}</span>
          </span>
        </div>
        <div className="settings-row settings-row--static">
          <span className="settings-row__text">
            <span className="settings-row__hint">{t.fieldInstitute}</span>
            <span className="settings-row__title">{profile.group.institute || '—'}</span>
          </span>
        </div>
        <button type="button" className="settings-row" onClick={onChangeGroup}>
          <span className="settings-row__text">
            <span className="settings-row__hint">{t.fieldGroup}{profile.group.course ? ` · ${t.course(profile.group.course)}` : ''}</span>
            <span className="settings-row__title">{profile.group.title}</span>
          </span>
          <span className="text-button">{t.changeGroup}</span>
          <ChevronRight size={18} />
        </button>
      </div>

      <p className="field-label">{t.subgroupField}</p>
      <div className="choice-list" role="radiogroup" aria-label={t.subgroupField}>
        {([1, 2, null] as const).map((value) => (
          <button key={String(value)} type="button" role="radio" className="choice" aria-checked={subgroup === value} data-current={t.current} onClick={() => choose(value)}>
            <span className="choice__text">
              <span className="choice__title">{value ? t.subgroup(value) : t.wholeGroupTitle}</span>
              <span className="choice__hint">{value === 1 ? t.subgroupOne : value === 2 ? t.subgroupTwo : t.subgroupAllHint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="hint">{t.groupChangeWarning}</p>
    </div>
  );
};
