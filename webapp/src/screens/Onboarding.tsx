import { useMemo, useState } from 'react';
import { Button, CellList, CellSimple, Input, Typography } from '@maxhub/max-ui';
import { loadGroups, type Group } from '../data/schedule';
import type { LocalProfile } from '../lib/profile';
import { useAsync } from '../lib/useAsync';
import { ErrorState, Loading } from '../components/Status';

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[\s-]+/g, '');

export const Onboarding = ({ onDone }: { onDone: (profile: LocalProfile) => void }) => {
  const [groups, retry] = useAsync(loadGroups, []);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Group | null>(null);

  const results = useMemo(() => {
    if (groups.status !== 'ready') return [];
    const needle = normalize(query);
    if (needle.length < 2) return [];
    return groups.data.filter((group) => normalize(group.title).includes(needle)).slice(0, 30);
  }, [groups, query]);

  if (picked) {
    return (
      <div className="screen">
        <Typography.Headline>{picked.title}</Typography.Headline>
        <Typography.Body className="muted">Выбери подгруппу — покажем только твои пары</Typography.Body>
        <div className="stack">
          <Button stretched onClick={() => onDone({ group: picked, subgroup: 1 })}>1 подгруппа</Button>
          <Button stretched onClick={() => onDone({ group: picked, subgroup: 2 })}>2 подгруппа</Button>
          <Button stretched variant="secondary" onClick={() => onDone({ group: picked, subgroup: null })}>
            Вся группа
          </Button>
          <Button stretched variant="ghost" onClick={() => setPicked(null)}>Выбрать другую группу</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Typography.Headline>Твоя группа</Typography.Headline>
      <Typography.Body className="muted">Введи название, например ИСТб-25-1</Typography.Body>
      <Input
        autoFocus
        placeholder="Поиск группы"
        value={query}
        withClearButton
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.status === 'loading' && <Loading />}
      {groups.status === 'error' && <ErrorState message={groups.message} onRetry={retry} />}
      {groups.status === 'ready' && normalize(query).length >= 2 && results.length === 0 && (
        <Typography.Body className="muted">Ничего не нашли. Проверь написание</Typography.Body>
      )}
      {results.length > 0 && (
        <CellList mode="island" filled>
          {results.map((group) => (
            <CellSimple
              key={group.id}
              title={group.title}
              subtitle={[group.institute, group.course && `${group.course} курс`].filter(Boolean).join(' · ')}
              showChevron
              onClick={() => setPicked(group)}
            />
          ))}
        </CellList>
      )}
    </div>
  );
};
