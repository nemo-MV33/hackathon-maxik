import { apiRequest } from '../lib/api';
import { useI18n, type Lang } from '../lib/i18n';

const OPTIONS: { value: Lang; label: string; name: string }[] = [
  { value: 'ru', label: 'RU', name: 'Русский' },
  { value: 'en', label: 'EN', name: 'English' },
];

// Язык общий с ботом: выбор здесь сохраняется в профиль, и бот начинает отвечать так же.
export const LanguageSwitch = () => {
  const { lang, t, setLang } = useI18n();
  const choose = (value: Lang) => {
    if (value === lang) return;
    setLang(value);
    apiRequest('/api/me', { method: 'PUT', body: JSON.stringify({ lang: value }) }).catch(() => {});
  };
  return (
    <div className="lang-switch" role="radiogroup" aria-label={t.language}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={lang === option.value}
          aria-label={option.name}
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
