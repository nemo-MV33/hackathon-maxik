import { t } from './i18n';

// Вузы мини-приложения. Повторяет src/universities/config.js: идентификаторы нужны
// до первого запроса к серверу, чтобы разобрать ссылку из уведомления бота.
export type University = {
  id: string;
  name: { ru: string; en: string };
  fullName: { ru: string; en: string };
  city: { ru: string; en: string };
  // Подпись к времени вуза, когда пояс студента другой: «08:15 по Иркутску».
  clock: { ru: string; en: string };
  timeZone: string;
  example: string;
  auditories: boolean;
  // Группа выбирается через каталог вуза, а не поиском по названию.
  catalog?: boolean;
};

export const UNIVERSITIES: University[] = [
  { id: 'irnitu', name: { ru: 'ИРНИТУ', en: 'IRNITU' }, city: { ru: 'Иркутск', en: 'Irkutsk' }, clock: { ru: 'по Иркутску', en: 'Irkutsk time' }, timeZone: 'Asia/Irkutsk',
    fullName: { ru: 'Иркутский национальный исследовательский технический университет', en: 'Irkutsk National Research Technical University' },
    example: 'ИСТб-25-1', auditories: true },
  { id: 'bgu', name: { ru: 'БГУ', en: 'BSU' }, city: { ru: 'Иркутск', en: 'Irkutsk' }, clock: { ru: 'по Иркутску', en: 'Irkutsk time' }, timeZone: 'Asia/Irkutsk',
    fullName: { ru: 'Байкальский государственный университет', en: 'Baikal State University' },
    example: 'ГМУ-25-1', auditories: false },
  { id: 'spbpu', name: { ru: 'СПбПУ', en: 'SPbPU' }, city: { ru: 'Санкт-Петербург', en: 'Saint Petersburg' }, clock: { ru: 'по Петербургу', en: 'St Petersburg time' }, timeZone: 'Europe/Moscow',
    fullName: { ru: 'Политехнический университет Петра Великого', en: 'Peter the Great Polytechnic University' },
    example: '5130903/30301', auditories: true },
  { id: 'spbu', name: { ru: 'СПбГУ', en: 'SPbU' }, city: { ru: 'Санкт-Петербург', en: 'Saint Petersburg' }, clock: { ru: 'по Петербургу', en: 'St Petersburg time' }, timeZone: 'Europe/Moscow',
    fullName: { ru: 'Санкт-Петербургский государственный университет', en: 'Saint Petersburg State University' },
    example: '25.Б20-фз', auditories: false, catalog: true },
];

const PATTERN = UNIVERSITIES.map((item) => item.id).join('|');
// Идентификатор группы с вузом: «spbpu~45680». Старые числовые без префикса — это ИРНИТУ.
export const GROUP_ID = `(?:(?:${PATTERN})~)?\\d+`;
export const SCOPED_GROUP_ID = `(?:${PATTERN})~\\d+`;
// В ссылке MAX «~» заменён на «-»: spbpu-45680.
export const decodeStartParam = (value: string) => value.replace(new RegExp(`(${PATTERN})-(?=\\d)`, 'g'), '$1~');
export const scopedGroupId = (id: string | number) => (String(id).includes('~') ? String(id) : `irnitu~${id}`);

export const universityOf = (groupId?: string | number | null) => {
  const prefix = String(groupId ?? '').split('~')[0];
  return UNIVERSITIES.find((item) => item.id === prefix) ?? UNIVERSITIES[0];
};

const lang = () => (t().locale.startsWith('en') ? 'en' : 'ru');
export const universityName = (item: University) => item.name[lang()];
export const universityFullName = (item: University) => item.fullName[lang()];
export const universityCity = (item: University) => item.city[lang()];
export const universityClock = (groupId?: string | number | null) => universityOf(groupId).clock[lang()];
// Часовой пояс пары без явного пояса — по вузу её группы.
export const groupTimeZone = (groupId?: string | number | null) => universityOf(groupId).timeZone;
