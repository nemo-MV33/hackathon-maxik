import { hasNativeBackButton } from '../bridge/max';
import { useBackButton } from '../lib/useBackButton';
import { ChevronLeft } from './Icon';

type Props = { title?: string; label: string; onBack: () => void; eyebrow?: string };

// Заголовок вложенного экрана: в MAX «Назад» — системная кнопка, в браузере — ссылка сверху.
export const BackHeader = ({ title, label, onBack, eyebrow }: Props) => {
  useBackButton(onBack);
  return (
    <>
      {!hasNativeBackButton() && (
        <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={18} />{label}</button>
      )}
      {(title || eyebrow) && (
        <div className="page-head">
          {eyebrow && <p className="page-head__eyebrow">{eyebrow}</p>}
          {title && <h1 className="display">{title}</h1>}
        </div>
      )}
    </>
  );
};
