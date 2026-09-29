import { useI18n } from '../lib/i18n';
import { BackHeader } from '../components/BackHeader';
import { ChevronDown } from '../components/Icon';

// Частые вопросы о приложении.
export const FaqScreen = ({ onBack }: { onBack: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="screen screen--section">
      <BackHeader label={t.profile} onBack={onBack} title={t.faq} />
      {t.faqItems.map((group) => (
        <section key={group.title} className="faq-group">
          <p className="settings__label">{group.title}</p>
          <div className="faq">
            {group.items.map(([question, answer]) => (
              <details key={question} className="faq__item">
                <summary className="faq__question">{question}<ChevronDown size={18} /></summary>
                <p className="faq__answer">{answer}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
