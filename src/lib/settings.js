// Настройки уведомлений общие для бота, мини-приложения и сервисов рассылки.

export const NOTIFICATION_KINDS = ['summary', 'homework', 'changes', 'exams', 'announcements', 'lessonEnd'];
// Эти уведомления включены, пока пользователь сам их не выключит; «конец пары» — наоборот.
const OFF_BY_DEFAULT = new Set(['lessonEnd']);

export const REMINDER_MINUTES = [5, 10, 15, 30];
export const END_MINUTES = [5, 10];
export const DEFAULT_REMINDER_MINUTES = 15;
export const DEFAULT_END_MINUTES = 5;
export const DEFAULT_SUMMARY_TIME = '20:00';
export const SUMMARY_TIME_PATTERN = /^(1[6-9]|2[0-3]):(00|30)$/;

export const isMuted = (prefs) => prefs?.muted === true;

export const notificationEnabled = (prefs, kind) => {
  if (isMuted(prefs)) return false;
  const value = prefs?.notifications?.[kind];
  return OFF_BY_DEFAULT.has(kind) ? value === true : value !== false;
};

export const remindersEnabled = (prefs) => !isMuted(prefs) && prefs?.remindersEnabled !== false;

export const reminderMinutes = (prefs) =>
  (REMINDER_MINUTES.includes(prefs?.reminderMinutes) ? prefs.reminderMinutes : DEFAULT_REMINDER_MINUTES);

export const endMinutes = (prefs) =>
  (END_MINUTES.includes(prefs?.endMinutes) ? prefs.endMinutes : DEFAULT_END_MINUTES);

export const summaryTime = (prefs) =>
  (SUMMARY_TIME_PATTERN.test(prefs?.summaryTime ?? '') ? prefs.summaryTime : DEFAULT_SUMMARY_TIME);

export const timeToMinutes = (value) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

// Опоздание в минутах для «досье»: студент указывает сам, старые записи — по коду причины.
export const LESSON_MINUTES = 90;
const LEGACY_LATE_MINUTES = { late10: 10, late20: 20, transport: 15 };
export const noticeMinutes = (notice) => {
  if (notice.kind === 'absent') return LESSON_MINUTES;
  if (Number.isInteger(notice.minutes) && notice.minutes > 0) return notice.minutes;
  return LEGACY_LATE_MINUTES[notice.reasonCode] ?? 10;
};
