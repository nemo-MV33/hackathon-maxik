import { useEffect, useState } from 'react';
import { Input } from '@maxhub/max-ui';
import { loadCatalog, searchGroups, type CatalogItem, type Group } from '../data/schedule';
import type { LocalProfile } from '../lib/profile';
import { useBackButton } from '../lib/useBackButton';
import { hasNativeBackButton } from '../bridge/max';
import { ErrorState, Loading } from '../components/Status';
import { ChevronLeft, ChevronRight, SearchIcon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { useI18n } from '../lib/i18n';
import { UNIVERSITIES, universityCity, universityFullName, universityName, universityOf } from '../lib/universities';

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
        <p className="eyebrow">3 / 3 · {t.subgroupField}</p>
        <h1 className="display">{group.title}</h1>
        <p className="hint">{[group.institute, group.course && t.course(group.course)].filter(Boolean).join(', ')}</p>
      </div>
      <div className="subgroup-options" role="radiogroup" aria-label={t.subgroupField}>
        {subgroups.map((option) => (
          <button
            key={option.title}
            type="button"
            role="radio"
            aria-checked={currentSubgroup === option.value}
            className="subgroup-option"
            onClick={() => onPick(option.value)}
          >
            <span className="choice__text">
              <span className="choice__title" data-current={t.current}>{option.title}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="hint">{t.subgroupChangeHint}</p>
    </div>
  );
};

// Каталог вуза без поиска групп (СПбГУ): направление → программа → год набора → группа.
const CatalogStep = ({ universityId, onPick }: { universityId: string; onPick: (group: Group) => void }) => {
  const { t } = useI18n();
  const [path, setPath] = useState<CatalogItem[]>([]);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const key = path.map((item) => item.id).join('/');
  useEffect(() => {
    let active = true;
    setItems(null); setError(null); setFilter('');
    loadCatalog(universityId, key)
      .then((value) => { if (active) setItems(value); })
      .catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [universityId, key, attempt]);
  const needle = filter.trim().toLowerCase().replace(/ё/g, 'е');
  const visible = (items ?? []).filter((item) => !needle || `${item.title} ${item.hint ?? ''}`.toLowerCase().replace(/ё/g, 'е').includes(needle));
  return (
    <>
      {path.length > 0 && <BackLink label={path.at(-1)!.title} onClick={() => setPath((current) => current.slice(0, -1))} />}
      <p className="field-label">{t.catalogSteps[Math.min(path.length, 3)]}</p>
      {items && items.length > 12 && (
        <label className="search-field">
          <SearchIcon size={18} />
          <input type="search" placeholder={t.catalogFilter} value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t.catalogFilter} />
        </label>
      )}
      {!items && !error && <Loading />}
      {error && <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {items && visible.length === 0 && <p className="hint">{t.searchNothing}</p>}
      <ul className="result-list">
        {visible.map((item) => (
          <li key={item.id}>
            <button type="button" className="result" onClick={() => (item.kind === 'group'
              ? onPick({ id: item.id, universityId, title: item.title, institute: item.institute ?? '', course: item.course ?? null })
              : setPath((current) => [...current, item]))}>
              <span className="result__title">{item.title}</span>
              {item.hint && <span className="result__meta">{item.hint}</span>}
              {item.course && <span className="result__course">{t.course(item.course)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

export const Onboarding = ({ current, onDone, onCancel }: Props) => {
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Group | null>(null);
  useBackButton(picked ? undefined : universityId ? () => setUniversityId(null) : onCancel);
  const { t } = useI18n();
  const text = query.trim();
  const searching = text.length >= 2;

  // Поиск с паузой 250 мс: запрос уходит, когда студент перестал печатать.
  useEffect(() => {
    if (!universityId || !searching) { setResults(null); setError(null); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      searchGroups(universityId, text)
        .then((items) => { if (active) { setResults(items); setError(null); } })
        .catch((failure: Error) => { if (active) setError(failure.message); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [universityId, text, attempt]);

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

  if (!universityId) return (
    <div className="screen screen--onboarding">
      <div className="onboarding-top">
        {onCancel ? <BackLink label={t.back} onClick={onCancel} /> : <Wordmark />}
        <LanguageSwitch />
      </div>
      <div className="intro"><p className="step-pill">1 / 3</p><h1 className="display">{t.fieldUniversity}</h1></div>
      <div className="choice-list university-list">
        {UNIVERSITIES.map((item, index) => <button type="button" className="choice university-choice" key={item.id} onClick={() => setUniversityId(item.id)}>
          <span className="university-choice__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="choice__text">
            <span className="choice__head"><span className="choice__title">{universityName(item)}</span><span className={`badge city-badge city-badge--${item.timeZone === 'Asia/Irkutsk' ? 'irkutsk' : 'spb'}`}>{universityCity(item)}</span></span>
            <span className="choice__hint">{universityFullName(item)}</span>
          </span>
          <ChevronRight size={18} className="university-choice__chevron" />
        </button>)}
      </div>
    </div>
  );

  const university = universityOf(`${universityId}~0`);

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
      <BackLink label={t.fieldUniversity} onClick={() => { setUniversityId(null); setQuery(''); }} />
      <p className="eyebrow"><span className="step-pill">2 / 3</span>{universityName(university)}</p>
      {university.catalog ? <CatalogStep universityId={university.id} onPick={setPicked} /> : <>
      <div className="search">
        <label className="field-label" htmlFor="group-search">{t.groupField}</label>
        <Input
          id="group-search"
          autoFocus={!onCancel}
          size="large"
          mode="contrast"
          iconBefore={<SearchIcon size={20} />}
          placeholder={university.example}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={query}
          withClearButton
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {searching && !results && !error && <Loading />}
      {error && <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {results && results.length === 0 && <p className="hint">{t.searchEmpty(university.example)}</p>}
      {results && results.length > 0 && (
        <ul className="result-list" aria-label={t.foundGroups}>
          {results.map((group) => (
            <li key={group.id}>
              <button type="button" className="result" onClick={() => setPicked(group)}>
                <span className="result__title">{group.title}</span>
                {group.institute && <span className="result__meta">{group.institute}</span>}
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
      </>}
    </div>
  );
};
