import { Panel, Typography } from '@maxhub/max-ui';
import { currentUser, webApp } from './bridge/max';

export const App = () => {
  const user = currentUser();
  return (
    <Panel centeredX centeredY>
      <Typography.Headline>norfly</Typography.Headline>
      <Typography.Body>
        {user ? `Привет, ${user.first_name ?? user.username ?? user.id}!` : 'Открой приложение из MAX'}
      </Typography.Body>
      <Typography.Label>Платформа: {webApp()?.platform ?? 'браузер'}</Typography.Label>
    </Panel>
  );
};
