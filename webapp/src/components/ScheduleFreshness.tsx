import { useI18n } from '../lib/i18n';
import { useNow } from '../lib/useNow';

export const ScheduleFreshness = ({ at, stale }: { at?: string | null; stale?: boolean }) => {
  const { t } = useI18n();
  useNow();
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return <p className="footnote">{stale && <>{t.sourceUnavailable}<br /></>}{t.updatedMinutes(Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000)))}</p>;
};
