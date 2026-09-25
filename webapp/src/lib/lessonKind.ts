const KINDS: Record<string, string> = {
  лекция: 'lecture',
  практика: 'practice',
  лабораторная: 'lab',
  экзамен: 'exam',
  зачёт: 'credit',
};

export const lessonKindClass = (lessonType: string) => `kind-${KINDS[lessonType] ?? 'other'}`;
