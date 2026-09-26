import { t } from './i18n';

const KINDS: Record<string, { key: string; code: string; codeEn: string; nameEn: string }> = {
  лекция: { key: 'lecture', code: 'ЛК', codeEn: 'LEC', nameEn: 'lecture' },
  практика: { key: 'practice', code: 'ПР', codeEn: 'PR', nameEn: 'practice' },
  лабораторная: { key: 'lab', code: 'ЛАБ', codeEn: 'LAB', nameEn: 'lab' },
  экзамен: { key: 'exam', code: 'ЭКЗ', codeEn: 'EXAM', nameEn: 'exam' },
  зачёт: { key: 'credit', code: 'ЗАЧ', codeEn: 'TEST', nameEn: 'pass/fail test' },
  консультация: { key: 'other', code: 'КОНС', codeEn: 'CONS', nameEn: 'consultation' },
};

const english = () => t().locale.startsWith('en');

const kind = (lessonType: string) => KINDS[lessonType.toLowerCase()];

export const lessonKindClass = (lessonType: string) => `kind-${kind(lessonType)?.key ?? 'other'}`;

export const lessonKindCode = (lessonType: string) => {
  const found = kind(lessonType);
  if (found) return english() ? found.codeEn : found.code;
  return lessonType.slice(0, 3).toUpperCase() || '—';
};

export const lessonKindName = (lessonType: string) => (english() ? kind(lessonType)?.nameEn : undefined) ?? lessonType;

export const isControlLesson = (lessonType: string) => ['exam', 'credit'].includes(kind(lessonType)?.key ?? '');
