import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'ru' | 'en';

const KEY = 'norfly.lang';

const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const ru = {
  locale: 'ru-RU',
  weekdays: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
  today: 'Сегодня',
  tomorrow: 'Завтра',
  yesterday: 'Вчера',
  day: 'День',
  week: 'Неделя',
  scheduleView: 'Вид расписания',
  weekDays: 'Дни недели',
  previousWeek: 'Предыдущая неделя',
  nextWeek: 'Следующая неделя',
  even: 'чётная',
  odd: 'нечётная',
  subgroup: (value: number) => `${value} подгруппа`,
  subgroupShort: (value: number) => `${value} подгр.`,
  wholeGroup: 'вся группа',
  groupLabel: (title: string) => `Группа ${title}. Сменить`,
  pairs: (count: number) => `${count} ${plural(count, 'пара', 'пары', 'пар')}`,
  noPairs: 'пар нет',
  noLessonsTitle: 'Пар нет',
  noLessonsPast: 'В этот день занятий не было',
  noLessonsFree: 'Свободный день',
  emptyWeekTitle: 'Неделя без пар',
  emptyWeekText: 'Каникулы или сессия ещё не в расписании',
  footnote: (updated: string) => `Данные ИРНИТУ · обновлено ${updated}`,
  irkutsk: 'Иркутск',
  loadingSchedule: 'Загружаем расписание',

  live: (left: string) => `идёт · ещё ${left}`,
  untilFirst: (left: string) => `до первой пары ${left}`,
  breakUntil: (left: string) => `перерыв · до пары ${left}`,
  dayOver: 'пары на сегодня закончились',
  gap: (length: string) => `окно ${length}`,
  hours: 'ч',
  minutes: 'мин',
  homeworkShort: 'ДЗ',
  homeworkMine: 'ДЗ · лично',
  transferred: 'перенос',

  failedTitle: 'Не получилось',
  retry: 'Повторить',

  introTitle: 'Расписание ИРНИТУ и домашка группы',
  introLead: 'Пары на день и неделю, а у каждой пары — ДЗ, которое записал староста',
  otherGroup: 'Другая группа',
  currentGroup: (title: string) => `Сейчас выбрана ${title}`,
  scheduleBack: 'Расписание',
  groupField: 'Группа',
  searchHint: 'Начни вводить название — хватит пары символов',
  searchEmpty: 'Такой группы нет. Проверь написание — например, ИСТб-25-1',
  foundGroups: 'Найденные группы',
  course: (value: number) => `${value} курс`,
  subgroupField: 'Подгруппа',
  subgroupOne: 'Лабораторные и практики первой подгруппы',
  subgroupTwo: 'Лабораторные и практики второй подгруппы',
  subgroupAllHint: 'Все пары без деления на подгруппы',
  wholeGroupTitle: 'Вся группа',
  current: 'сейчас',
  subgroupChangeHint: 'Подгруппу можно поменять в любой момент — нажми на название группы в расписании',
  language: 'Язык',
  previewLecture: 'Лекция · Ж-301',
  previewPractice: 'Практика · Е-412',
  previewLab: 'Лаба · В-204',
  previewSubjectOne: 'Математический анализ',
  previewSubjectTwo: 'Английский язык',
  previewSubjectThree: 'Программирование',
  previewHomework: 'Лабораторная №3, отчёт',

  when: 'Когда',
  where: 'Где',
  who: 'Кто',
  forWhom: 'Для',
  forSubgroup: (value: number) => `${value} подгруппы`,
  note: 'Заметка',
  link: 'Ссылка',
  pair: (value: number) => `${value} пара`,
  homeworkTitle: 'Домашнее задание',
  roles: {
    headman: 'Ты староста: общее ДЗ видит вся группа',
    editor: 'Ты редактор ДЗ: общее ДЗ видит вся группа',
    member: 'В группе ДЗ может записывать любой участник',
    student: 'Общее ДЗ записывают староста и редакторы',
  },
  forGroup: 'Для группы',
  nobodyWrote: 'Пока никто не записал',
  edit: (value: number) => `правка ${value}`,
  forMe: 'Лично мне',
  noOwnVersion: 'Своей версии нет — видишь общее ДЗ',
  editShared: 'Изменить для группы',
  writeShared: 'Записать для группы',
  editOwn: 'Изменить свою версию',
  writeOwn: 'Записать себе',
  deleteOwn: 'Удалить свою версию',
  deleteShared: 'Удалить у группы',
  confirmDelete: 'Точно удалить у всей группы?',
  sharedScope: 'Увидит вся группа, в том числе в чате с ботом',
  ownScope: 'Увидишь только ты. Общее ДЗ не изменится',
  placeholder: 'Стр. 45, № 1–10. Подготовить доклад к семинару',
  save: 'Сохранить',
  cancel: 'Отмена',
  savedShared: 'Сохранено — группа уже видит',
  savedOwn: 'Сохранено только для тебя',
  deletedOwn: 'Снова показываем общее ДЗ',
  deletedShared: 'Общее ДЗ удалено',

  sharedWithYou: 'Тебе переслали ДЗ',
  groupNotFound: 'не найдена',
  task: 'Задание',
  otherGroupWarning: (their: string, mine: string) =>
    `Это ДЗ группы ${their}, а у тебя выбрана ${mine}. После сохранения расписание переключится на ${their}`,
  lessonMissing: 'Этой пары нет в расписании ИРНИТУ — сохранить ДЗ не получится',
  saveForMe: 'Сохранить себе',
  dontSave: 'Не сохранять',
  brokenLinkTitle: 'Ссылка не открылась',
  brokenLinkText: 'Она повреждена или устарела. Попроси одногруппника прислать её ещё раз',
  openSchedule: 'Открыть расписание',
  findingLesson: 'Ищем пару в расписании',

  outsideMax: 'Домашка доступна, когда приложение открыто из бота в MAX',
  network: 'Нет связи с сервисом. Проверь интернет',
  failed: 'Не удалось выполнить действие',
  scheduleMissing: 'Расписание ещё не выгружено',
};

type Dictionary = typeof ru;

const en: Dictionary = {
  locale: 'en-GB',
  weekdays: ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'],
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  day: 'Day',
  week: 'Week',
  scheduleView: 'Timetable view',
  weekDays: 'Days of the week',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  even: 'even',
  odd: 'odd',
  subgroup: (value) => `subgroup ${value}`,
  subgroupShort: (value) => `subgr. ${value}`,
  wholeGroup: 'whole group',
  groupLabel: (title) => `Group ${title}. Change`,
  pairs: (count) => `${count} ${count === 1 ? 'class' : 'classes'}`,
  noPairs: 'no classes',
  noLessonsTitle: 'No classes',
  noLessonsPast: 'There were no classes that day',
  noLessonsFree: 'A free day',
  emptyWeekTitle: 'No classes this week',
  emptyWeekText: 'Holidays, or the exam timetable is not published yet',
  footnote: (updated) => `INRTU data · updated ${updated}`,
  irkutsk: 'Irkutsk',
  loadingSchedule: 'Loading the timetable',

  live: (left) => `now · ${left} left`,
  untilFirst: (left) => `first class in ${left}`,
  breakUntil: (left) => `break · next class in ${left}`,
  dayOver: 'classes are over for today',
  gap: (length) => `gap ${length}`,
  hours: 'h',
  minutes: 'min',
  homeworkShort: 'HW',
  homeworkMine: 'HW · mine',
  transferred: 'moved',

  failedTitle: 'Something went wrong',
  retry: 'Try again',

  introTitle: 'INRTU timetable and group homework',
  introLead: 'Classes for the day and week, with homework recorded by your class representative',
  otherGroup: 'Another group',
  currentGroup: (title) => `Currently ${title}`,
  scheduleBack: 'Timetable',
  groupField: 'Group',
  searchHint: 'Start typing the name — a couple of characters is enough',
  searchEmpty: 'No such group. Check the spelling — for example ИСТб-25-1',
  foundGroups: 'Groups found',
  course: (value) => `year ${value}`,
  subgroupField: 'Subgroup',
  subgroupOne: 'Labs and practice classes of subgroup 1',
  subgroupTwo: 'Labs and practice classes of subgroup 2',
  subgroupAllHint: 'All classes, no subgroup filter',
  wholeGroupTitle: 'Whole group',
  current: 'current',
  subgroupChangeHint: 'You can change the subgroup any time — tap the group name in the timetable',
  language: 'Language',
  previewLecture: 'Lecture · Ж-301',
  previewPractice: 'Practice · Е-412',
  previewLab: 'Lab · В-204',
  previewSubjectOne: 'Calculus',
  previewSubjectTwo: 'English',
  previewSubjectThree: 'Programming',
  previewHomework: 'Lab 3, write the report',

  when: 'When',
  where: 'Where',
  who: 'Teacher',
  forWhom: 'For',
  forSubgroup: (value) => `subgroup ${value}`,
  note: 'Note',
  link: 'Link',
  pair: (value) => `class ${value}`,
  homeworkTitle: 'Homework',
  roles: {
    headman: 'You are the class representative: the whole group sees group homework',
    editor: 'You are a homework editor: the whole group sees group homework',
    member: 'Anyone in the group can add homework',
    student: 'Group homework is added by the representative and editors',
  },
  forGroup: 'For the group',
  nobodyWrote: 'Nobody has added it yet',
  edit: (value) => `edit ${value}`,
  forMe: 'Just for me',
  noOwnVersion: 'No own version — you see the group homework',
  editShared: 'Edit for the group',
  writeShared: 'Add for the group',
  editOwn: 'Edit my version',
  writeOwn: 'Add for myself',
  deleteOwn: 'Delete my version',
  deleteShared: 'Delete for the group',
  confirmDelete: 'Delete it for the whole group?',
  sharedScope: 'The whole group will see it, including in the bot chat',
  ownScope: 'Only you will see it. The group homework stays unchanged',
  placeholder: 'Page 45, ex. 1–10. Prepare a talk for the seminar',
  save: 'Save',
  cancel: 'Cancel',
  savedShared: 'Saved — the group can see it',
  savedOwn: 'Saved just for you',
  deletedOwn: 'Showing the group homework again',
  deletedShared: 'Group homework deleted',

  sharedWithYou: 'Homework shared with you',
  groupNotFound: 'not found',
  task: 'Task',
  otherGroupWarning: (their, mine) =>
    `This homework is for ${their}, but you have ${mine} selected. After saving, the timetable switches to ${their}`,
  lessonMissing: 'This class is not in the INRTU timetable, so it cannot be saved',
  saveForMe: 'Save for me',
  dontSave: 'Don’t save',
  brokenLinkTitle: 'The link did not open',
  brokenLinkText: 'It is broken or out of date. Ask your classmate to send it again',
  openSchedule: 'Open timetable',
  findingLesson: 'Looking for the class',

  outsideMax: 'Homework is available when the app is opened from the bot in MAX',
  network: 'No connection to the service. Check your internet',
  failed: 'Could not complete the action',
  scheduleMissing: 'The timetable has not been loaded yet',
};

const dictionaries: Record<Lang, Dictionary> = { ru, en };

export const isLang = (value: unknown): value is Lang => value === 'ru' || value === 'en';

const initialLang = (): Lang => {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith('ru') !== false ? 'ru' : 'en';
};

// Текущий язык нужен и вне React (сообщения об ошибках API), поэтому дублируем его в модуле.
let currentLang: Lang = initialLang();
if (typeof document !== 'undefined') document.documentElement.lang = currentLang;
export const t = () => dictionaries[currentLang];

type I18n = { lang: Lang; t: Dictionary; setLang: (lang: Lang) => void };
const I18nContext = createContext<I18n>({ lang: currentLang, t: dictionaries[currentLang], setLang: () => {} });

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(currentLang);
  const setLang = useCallback((next: Lang) => {
    currentLang = next;
    document.documentElement.lang = next;
    try { localStorage.setItem(KEY, next); } catch {}
    setLangState(next);
  }, []);
  const value = useMemo(() => ({ lang, t: dictionaries[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
