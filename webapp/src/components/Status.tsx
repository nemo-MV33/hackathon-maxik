import { Button, Spinner, Typography } from '@maxhub/max-ui';

export const Loading = () => (
  <div className="status"><Spinner /></div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="status">
    <Typography.Body>{message}</Typography.Body>
    {onRetry && <Button variant="secondary" onClick={onRetry}>Повторить</Button>}
  </div>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="status"><Typography.Body>{children}</Typography.Body></div>
);
