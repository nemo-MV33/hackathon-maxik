import { Button, Spinner } from '@maxhub/max-ui';
import { useI18n } from '../lib/i18n';

export const Loading = ({ label }: { label?: string }) => (
  <div className="status" role="status" aria-live="polite">
    <Spinner />
    {label && <p className="status__text">{label}</p>}
  </div>
);

export const ScheduleSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="cards" aria-busy="true">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="card card--skeleton">
        <i className="bone bone--time" />
        <i className="bone bone--title" />
        <i className="bone bone--meta" />
      </div>
    ))}
  </div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="status status--error" role="alert">
      <p className="status__title">{t.failedTitle}</p>
      <p className="status__text">{message}</p>
      {onRetry && <Button size="small" variant="secondary" onClick={onRetry}>{t.retry}</Button>}
    </div>
  );
};

export const Empty = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="status status--empty">
    <p className="status__title">{title}</p>
    {children && <p className="status__text">{children}</p>}
  </div>
);
