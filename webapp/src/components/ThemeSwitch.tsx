import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeChoice } from '../lib/theme';

const OPTIONS: ThemeChoice[] = ['light', 'dark', 'auto'];

// Тема хранится на устройстве: у одного человека телефон может быть в тёмной теме, а ноутбук — в светлой.
export const ThemeSwitch = () => {
  const { t } = useI18n();
  const { choice, setChoice } = useTheme();
  return (
    <div className="lang-switch" role="radiogroup" aria-label={t.theme}>
      {OPTIONS.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={choice === option} onClick={() => setChoice(option)}>
          {t.themeNames[option]}
        </button>
      ))}
    </div>
  );
};
