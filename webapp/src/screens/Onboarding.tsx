import { useMemo, useState } from 'react';
import { Input } from '@maxhub/max-ui';
import { loadGroups, type Group } from '../data/schedule';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { useBackButton } from '../lib/useBackButton';
import { hasNativeBackButton } from '../bridge/max';
import { ErrorState, Loading } from '../components/Status';
import { ChevronLeft, ChevronRight, SearchIcon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { useI18n } from '../lib/i18n';

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-–—]+/g, '');
const LATIN: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
// Латиницей группу тоже находим: «istb-25-1» → «ИСТб-25-1».
const transliterate = (value: string) => [...value].map((char) => LATIN[char] ?? char).join('');
const position = (title: string, needle: string) => {
  const target = normalize(title);
  const found = target.indexOf(needle);
  return found >= 0 ? found : transliterate(target).indexOf(needle);
};


type Props = {
  current: LocalProfile | null;
  onDone: (profile: LocalProfile) => void;
  onCancel?: () => void;
};

// Декоративный пример расписания на первом экране: показывает, что будет после выбора группы.
const Preview = () => {
  const { t } = useI18n();
  return (
    <div className="preview" aria-hidden="true">
      <div className="card kind-lecture card--past preview__card">
        <span className="card__row"><span className="card__time">08:15<small>– 09:45</small></span><span className="card__kind">{t.previewLecture}</span></span>
        <span className="card__subject">{t.previewSubjectOne}</span>
      </div>
      <div className="card card--live preview__card">
        <span className="card__row"><span className="card__time">10:00<small>– 11:30</small></span><span className="card__kind">{t.previewPractice}</span></span>
        <span className="card__subject">{t.previewSubjectTwo}</span>
        <span className="card__live">{t.live(`40 ${t.minutes}`)}<span className="meter"><i style={{ width: '55%' }} /></span></span>
      </div>
      <div className="card kind-lab preview__card">
        <span className="card__row"><span className="card__time">11:45<small>– 13:15</small></span><span className="card__kind">{t.previewLab}</span></span>
        <span className="card__subject">{t.previewSubjectThree}</span>
        <span className="card__hw"><span className="card__hw-label">{t.homeworkShort}</span><span className="card__hw-text">{t.previewHomework}</span></span>
      </div>
    </div>
  );
};

const BackLink = ({ label, onClick }: { label: string; onClick: () => void }) => (
  hasNativeBackButton() ? null : (
    <button type="button" className="back-link" onClick={onClick}>
      <ChevronLeft size={18} />{label}
    </button>
  )
);

const SubgroupStep = ({ group, current, onPick, onBack }: {
  group: Group;
  current: LocalProfile | null;
  onPick: (subgroup: 1 | 2 | null) => void;
  onBack: () => void;
}) => {
  useBackButton(onBack);
  const { t } = useI18n();
  const subgroups: { value: 1 | 2 | null; title: string; hint: string }[] = [
    { value: 1, title: t.subgroup(1), hint: t.subgroupOne },
    { value: 2, title: t.subgroup(2), hint: t.subgroupTwo },
    { value: null, title: t.wholeGroupTitle, hint: t.subgroupAllHint },
  ];
  const currentSubgroup = current?.group.id === group.id ? current.subgroup : undefined;
  return (
    <div className="screen">
      <BackLink label={t.otherGroup} onClick={onBack} />
      <div className="intro">
        <p className="eyebrow">{[group.institute, group.course && t.course(group.course)].filter(Boolean).join(' · ')}</p>
        <h1 className="display">{group.title}</h1>
      </div>
      <div className="choice-list" role="radiogroup" aria-label={t.subgroupField}>
        {subgroups.map((option) => (
          <button
            key={option.title}
            type="button"
            role="radio"
            aria-checked={currentSubgroup === option.value}
            className="choice"
            onClick={() => onPick(option.value)}
          >
            <span className="choice__text">
              <span className="choice__title" data-current={t.current}>{option.title}</span>
              <span className="choice__hint">{option.hint}</span>
            </span>
            <ChevronRight size={18} className="choice__chevron" />
          </button>
        ))}
      </div>
      <p className="hint">{t.subgroupChangeHint}</p>
    </div>
  );
};

export const Onboarding = ({ current, onDone, onCancel }: Props) => {
  const [groups, retry] = useAsync(loadGroups, []);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Group | null>(null);
  useBackButton(picked ? undefined : onCancel);
  const { t } = useI18n();

  const results = useMemo(() => {
    if (groups.status !== 'ready') return [];
    const needle = normalize(query);
    if (needle.length < 2) return [];
    return groups.data
      .filter((group) => position(group.title, needle) >= 0)
      .sort((a, b) => Number(position(a.title, needle) > 0) - Number(position(b.title, needle) > 0))
      .slice(0, 30);
  }, [groups, query]);

  if (picked) {
    return (
      <SubgroupStep
        group={picked}
        current={current}
        onBack={() => setPicked(null)}
        onPick={(subgroup) => onDone({ group: picked, subgroup })}
      />
    );
  }

  const searching = normalize(query).length >= 2;

  return (
    <div className="screen screen--onboarding">
      <div className="onboarding-top">
        {onCancel ? <BackLink label={t.scheduleBack} onClick={onCancel} /> : <Wordmark />}
        <LanguageSwitch />
      </div>
      {!onCancel && (
        <div className="intro">
          <h1 className="display">{t.introTitle}</h1>
          <p className="lead">{t.introLead}</p>
        </div>
      )}
      {onCancel && (
        <div className="intro">
          <h1 className="display">{t.otherGroup}</h1>
          {current && <p className="lead">{t.currentGroup(current.group.title)}</p>}
        </div>
      )}
      <div className="search">
        <label className="field-label" htmlFor="group-search">{t.groupField}</label>
        <Input
          id="group-search"
          autoFocus={!onCancel}
          size="large"
          mode="contrast"
          iconBefore={<SearchIcon size={20} />}
          placeholder="ИСТб-25-1"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={query}
          withClearButton
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {groups.status === 'loading' && searching && <Loading />}
      {groups.status === 'error' && <ErrorState message={groups.message} onRetry={retry} />}
      {groups.status === 'ready' && searching && results.length === 0 && (
        <p className="hint">{t.searchEmpty}</p>
      )}
      {results.length > 0 && (
        <ul className="result-list" aria-label={t.foundGroups}>
          {results.map((group) => (
            <li key={group.id}>
              <button type="button" className="result" onClick={() => setPicked(group)}>
                <span className="result__title">{group.title}</span>
                <span className="result__meta">{group.institute}</span>
                {group.course && <span className="result__course">{t.course(group.course)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && !onCancel && (
        <>
          <p className="hint">{t.searchHint}</p>
          <Preview />
        </>
      )}
    </div>
  );
};
