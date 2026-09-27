import { useEffect, useRef, useState } from 'react';
import { loadGroups } from '../data/schedule';
import { apiRequest } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { CloseIcon, SearchIcon } from './Icon';
import type { EntityTarget } from '../screens/EntityScheduleScreen';

type Filter = 'all' | 'teacher' | 'auditory' | 'group';
const FILTERS: Filter[] = ['all', 'teacher', 'auditory', 'group'];
const MIN_QUERY = 2;
const LIMIT = 12;

type Result = EntityTarget & { hint?: string };

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-–—]+/g, '');

// Поиск по расписанию ИРНИТУ: преподаватели и аудитории — через API, группы — из выгруженного списка.
export const ScheduleSearch = ({ onOpen, onClose }: { onOpen: (target: EntityTarget) => void; onClose: () => void }) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      setResults(null);
      setError(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const wants = (kind: Filter) => filter === 'all' || filter === kind;
      const q = encodeURIComponent(text);
      try {
        const [teachers, auditories, groups] = await Promise.all([
          wants('teacher') ? apiRequest<{ items: { id: number; name: string; fullName?: string }[] }>(`/api/teachers?q=${q}&limit=${LIMIT}`) : { items: [] },
          wants('auditory') ? apiRequest<{ items: { id: number; title: string }[] }>(`/api/auditories?q=${q}&limit=${LIMIT}`) : { items: [] },
          wants('group') ? loadGroups() : [],
        ]);
        if (!active) return;
        const needle = normalize(text);
        setResults([
          ...teachers.items.map((item): Result => ({ kind: 'teacher', id: item.id, title: item.fullName || item.name })),
          ...auditories.items.map((item): Result => ({ kind: 'auditory', id: item.id, title: item.title })),
          ...groups.filter((group) => normalize(group.title).includes(needle)).slice(0, LIMIT)
            .map((group): Result => ({ kind: 'group', id: group.id, title: group.title, hint: group.institute })),
        ]);
        setError(null);
      } catch (failure) {
        if (active) setError((failure as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, filter]);

  return (
    <div className="schedule-search">
      <div className="search-field">
        <SearchIcon size={18} />
        <input
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t.searchSchedule}
        />
        <button type="button" className="search-field__close" aria-label={t.closeSearch} onClick={onClose}><CloseIcon size={18} /></button>
      </div>
      <div className="chips chips--scroll" role="radiogroup" aria-label={t.searchWhat}>
        {FILTERS.map((value) => (
          <button key={value} type="button" role="radio" className="chip-option" aria-checked={filter === value} onClick={() => setFilter(value)}>
            {t.searchFilters[value]}
          </button>
        ))}
      </div>
      {query.trim().length > 0 && query.trim().length < MIN_QUERY && <p className="hint">{t.searchMore}</p>}
      {loading && !results && <p className="hint">{t.searching}</p>}
      {error && <p className="callout callout--error">{error}</p>}
      {results && results.length === 0 && !loading && <p className="hint">{t.searchNothing}</p>}
      {results && results.length > 0 && (
        <ul className="result-list" aria-busy={loading}>
          {results.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <button type="button" className="result" onClick={() => onOpen(item)}>
                <span className="result__title">{item.title}</span>
                {item.hint && <span className="result__meta">{item.hint}</span>}
                <span className="result__course">{t.searchKinds[item.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
