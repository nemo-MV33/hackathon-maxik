import { useI18n } from '../lib/i18n';
import { useNow } from '../lib/useNow';

export const ScheduleFreshness = ({ at }: { at?: string | null }) => {
  const { t } = useI18n();
  useNow();
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return <p className="footnote">{t.updatedMinutes(Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000)))}</p>;
};
