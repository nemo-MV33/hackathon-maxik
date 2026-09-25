import { Button, Spinner, Typography } from '@maxhub/max-ui';

export const Loading = () => (
  <div className="status"><Spinner /></div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="status">
    <span className="status__icon">⚠️</span>
    <Typography.Body>{message}</Typography.Body>
    {onRetry && <Button variant="secondary" onClick={onRetry}>Повторить</Button>}
  </div>
);

export const Empty = ({ icon = '🌿', children }: { icon?: string; children: React.ReactNode }) => (
  <div className="status">
    <span className="status__icon">{icon}</span>
    <Typography.Body className="muted">{children}</Typography.Body>
  </div>
);
