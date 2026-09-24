import { useEffect } from 'react';
import { webApp } from '../bridge/max';

export const useBackButton = (onBack: (() => void) | undefined) => {
  useEffect(() => {
    const button = webApp()?.BackButton;
    if (!button || !onBack) return undefined;
    button.show();
    button.onClick(onBack);
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [onBack]);
};
