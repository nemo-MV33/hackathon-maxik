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
import { Intro } from './components/Intro';
import { webApp } from './bridge/max';
import { watchForUpdates } from './lib/updates';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';

webApp()?.ready?.();
watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Тему выбирает пользователь в профиле: светлая, тёмная или как на устройстве. */}
    <ThemeProvider>
      {(theme) => (
        <MaxUI colorScheme={theme}>
          <I18nProvider>
            <App />
            <Intro />
          </I18nProvider>
        </MaxUI>
      )}
    </ThemeProvider>
  </StrictMode>,
);
