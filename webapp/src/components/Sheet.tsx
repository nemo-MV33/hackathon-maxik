import { useEffect, type ReactNode } from 'react';

type Props = { title: string; hint?: ReactNode; onClose: () => void; busy?: boolean; children: ReactNode; labelId: string };

// Нижняя шторка: закрывается тапом по фону и Esc, пока не идёт сохранение.
export const Sheet = ({ title, hint, onClose, busy = false, children, labelId }: Props) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('has-sheet');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-sheet');
    };
  }, [onClose, busy]);
  return (
    <div className="sheet-backdrop" onClick={() => !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={(event) => event.stopPropagation()}>
        <span className="sheet__grip" aria-hidden="true" />
        <h2 id={labelId} className="sheet__title">{title}</h2>
        {hint && <p className="sheet__hint">{hint}</p>}
        {children}
      </div>
    </div>
  );
};
