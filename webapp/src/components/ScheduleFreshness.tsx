import { useI18n } from '../lib/i18n';
import { useNow } from '../lib/useNow';

// Свежесть расписания: зелёная точка — источник отвечает, оранжевая — показан сохранённый вариант.
export const ScheduleFreshness = ({ at, stale }: { at?: string | null; stale?: boolean }) => {
  const { t } = useI18n();
  useNow();
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return <p className={`freshness${stale ? ' is-stale' : ''}`}>
    <span className="freshness__dot" aria-hidden="true" />
    {stale ? `${t.sourceUnavailable} ` : ''}{t.updatedMinutes(Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000)))}
  </p>;
};
