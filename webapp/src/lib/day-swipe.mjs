// Вертикальная прокрутка и короткие движения не переключают день.
export const daySwipe = (start, end) => {
  if (!start) return 0;
  const dx = end.x - start.x; const dy = end.y - start.y;
  return Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6 ? (dx < 0 ? 1 : -1) : 0;
};
