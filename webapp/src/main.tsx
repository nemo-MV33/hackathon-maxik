import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import '@fontsource-variable/manrope';
import '@fontsource/jetbrains-mono/cyrillic-500.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/cyrillic-600.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import { App } from './App';
import { webApp } from './bridge/max';
import { watchForUpdates } from './lib/updates';
import { I18nProvider } from './lib/i18n';

webApp()?.ready?.();
watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Светлая тема всегда: в тёмном режиме MAX карточки теряют обводку и цвета презентации. */}
    <MaxUI colorScheme="light">
      <I18nProvider>
        <App />
      </I18nProvider>
    </MaxUI>
  </StrictMode>,
);
