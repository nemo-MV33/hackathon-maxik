import { useEffect, useRef } from 'react';
import { webApp } from '../bridge/max';
import { BackButtonStack } from './back-button-stack.mjs';

let stack: BackButtonStack | undefined;

export const useBackButton = (onBack: (() => void) | undefined) => {
  const callback = useRef(onBack);
  callback.current = onBack;
  const enabled = Boolean(onBack);
  useEffect(() => {
    const app = webApp();
    if (!app?.initData || !app.BackButton || !enabled) return undefined;
    stack ??= new BackButtonStack(app.BackButton);
    return stack.add(() => callback.current?.());
  }, [enabled]);
};
