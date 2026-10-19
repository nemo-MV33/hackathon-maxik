import { useEffect, useRef, type ReactNode } from 'react';
import { useBackButton } from '../lib/useBackButton';
import { useI18n } from '../lib/i18n';
import { CloseIcon } from './Icon';

type Props = { title: string; hint?: ReactNode; onClose: () => void; busy?: boolean; children: ReactNode; labelId: string };
let openSheets = 0;
let pageScroll = 0;

export const Sheet = ({ title, hint, onClose, busy = false, children, labelId }: Props) => {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  close.current = onClose;
  locked.current = busy;
  useBackButton(() => { if (!busy) onClose(); });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? []].filter((element) => element.getClientRects().length > 0);
    if (!root.current?.contains(document.activeElement)) (controls()[0] ?? root.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked.current) close.current();
      if (event.key !== 'Tab') return;
      const items = controls();
      if (!items.length) { event.preventDefault(); root.current?.focus(); return; }
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    if (!openSheets) { pageScroll = window.scrollY; document.body.style.top = `-${pageScroll}px`; }
    openSheets += 1;
    document.body.classList.add('has-sheet');
    return () => {
      window.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (!openSheets) { document.body.classList.remove('has-sheet'); document.body.style.top = ''; window.scrollTo(0, pageScroll); }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <div className="sheet-backdrop" onClick={() => !busy && onClose()}>
    <div ref={root} className="sheet" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={labelId} onClick={(event) => event.stopPropagation()}>
      <span className="sheet__grip" aria-hidden="true" />
      <div className="sheet__header"><h2 id={labelId} className="sheet__title">{title}</h2><button type="button" className="icon-button" aria-label={t.closeForm} disabled={busy} onClick={onClose}><CloseIcon /></button></div>
      {hint && <p className="sheet__hint">{hint}</p>}
      {children}
    </div>
  </div>;
};
