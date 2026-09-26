import { useEffect, useRef } from 'react';
import { webApp } from '../bridge/max';

// Колбэк держим в ref, чтобы кнопка не мигала на каждом рендере из-за новой функции.
export const useBackButton = (onBack: (() => void) | undefined) => {
  const callback = useRef(onBack);
  callback.current = onBack;
  const enabled = Boolean(onBack);

  useEffect(() => {
    const button = webApp()?.BackButton;
    if (!button || !enabled) return undefined;
    const handler = () => callback.current?.();
    button.show();
    button.onClick(handler);
    return () => {
      button.offClick(handler);
      button.hide();
    };
  }, [enabled]);
};
