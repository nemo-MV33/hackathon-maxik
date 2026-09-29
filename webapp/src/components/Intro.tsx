import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import introVideo from '../assets/intro.mp4';
import introPoster from '../assets/intro.jpg';

// Заставка показывается один раз, при первом открытии приложения. Заменить анимацию: npm run intro -- файл.gif или файл.mp4
const KEY = 'norfly.intro';
const FADE_MS = 350;
// Если видео зависло на загрузке, заставка не держит пользователя дольше этого времени.
const LIMIT_MS = 12_000;

const shouldShow = () => {
  try {
    if (localStorage.getItem(KEY)) return false;
  } catch {
    return false;
  }
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
};

export const Intro = () => {
  const { t } = useI18n();
  const [visible, setVisible] = useState(shouldShow);
  const [leaving, setLeaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const finish = () => {
    try { localStorage.setItem(KEY, '1'); } catch {}
    setLeaving(true);
  };

  useEffect(() => {
    if (!visible) return undefined;
    const limit = window.setTimeout(finish, LIMIT_MS);
    // Если WebView запретил автозапуск, сразу открываем приложение, а не показываем застывший кадр.
    // AbortError бывает, когда окно свёрнуто: тогда видео продолжится само, а зависание закроет LIMIT_MS.
    video.current?.play()?.catch((error: DOMException) => { if (error.name === 'NotAllowedError') finish(); });
    return () => window.clearTimeout(limit);
  }, [visible]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => setVisible(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!visible) return null;
  return (
    <div className={`splash${leaving ? ' splash--leaving' : ''}`} onClick={finish} role="presentation">
      <video
        ref={video}
        className="splash__video"
        src={introVideo}
        poster={introPoster}
        muted
        autoPlay
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
      />
      <button type="button" className="splash__skip" onClick={finish}>{t.introSkip}</button>
    </div>
  );
};
