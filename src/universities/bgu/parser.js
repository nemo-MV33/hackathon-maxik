import { addDays, startOfWeek, toDateKey } from '../../lib/date.js';
export class BguSourceError extends Error {
  constructor(code) { super(code); this.name = 'BguSourceError'; this.code = code; }
}
const entities = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', laquo: '«', raquo: '»' };
export const htmlText = (value) => value.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (encoded, entity) => {
  if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? encoded;
  const point = entity.slice(1, 2).toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : encoded;
}).replace(/\s+/g, ' ').trim();
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/\s([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [match[1].toLowerCase(), match[3]]));
const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const russianDate = (text) => {
  const short = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (short) return `${short[3]}-${short[2]}-${short[1]}`;
  const verbose = text.toLowerCase().match(/\b(\d{1,2})\s+([а-я]+)\s+(\d{4})/);
  return verbose && months.includes(verbose[2]) ? `${verbose[3]}-${String(months.indexOf(verbose[2]) + 1).padStart(2, '0')}-${verbose[1].padStart(2, '0')}` : null;
};
export const parseGroups = (html) => {
  const groups = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=['"]\?idg=(\d+)['"][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = htmlText(match[2]);
    if (title) groups.set(Number(match[1]), { id: Number(match[1]), title, institute: '', course: null });
  }
  if (!groups.size) throw new BguSourceError('bgu_directory_unrecognized');
  return [...groups.values()];
};
export const parseParity = (html) => {
  const content = htmlText(html);
  const date = content.match(/Сегодня\s*-\s*(\d+)\s+([а-я]+)\s+(\d{4})/i);
  const parity = content.match(/Неделя\s+(нечетная|нечётная|четная|чётная)/i);
  if (!date || !parity || !months.includes(date[2].toLowerCase())) throw new BguSourceError('bgu_parity_unrecognized');
  return { date: `${date[3]}-${String(months.indexOf(date[2].toLowerCase()) + 1).padStart(2, '0')}-${date[1].padStart(2, '0')}`,
    weekEven: !parity[1].toLowerCase().startsWith('не') };
};
export const bguLessonTimes = {
  1: '08:30–10:00', 2: '10:15–11:45', 3: '12:00–13:30', 4: '14:00–15:30',
  5: '15:45–17:15', 6: '17:30–19:00', 7: '19:15–20:45',
};
const DAYS = ['ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА', 'ВОСКРЕСЕНЬЕ'];
const dateKey = (value) => { const [day, month, year] = value.split('.'); return `${year}-${month}-${day}`; };
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const lessonType = (kind) => /практическое/i.test(kind) ? 'практика' : /лаборатор/i.test(kind) ? 'лабораторная' : /лекц/i.test(kind) ? 'лекция' : /экзам/i.test(kind) ? 'экзамен' : /зач[её]т/i.test(kind) ? 'зачёт' : /консульт/i.test(kind) ? 'консультация' : kind.toLowerCase() || 'занятие';
const timing = (start) => {
  const match = start.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new BguSourceError('bgu_time_unrecognized');
  const normalized = `${match[1].padStart(2, '0')}:${match[2]}`;
  const known = Object.entries(bguLessonTimes).find(([, time]) => time.startsWith(normalized));
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return { lessonNumber: known ? Number(known[0]) : minutes + 1000,
    time: known?.[1] ?? `${normalized}–${clock(minutes + 90)}`, endEstimated: !known };
};
const parseTeacherTable = (html, { week, teacherId }) => {
  const pane = [...html.matchAll(/<div\b[^>]*>/gi)].find((match) => attributes(match[0]).id === 'pills-table');
  if (!pane) throw new BguSourceError('bgu_schedule_unrecognized');
  const table = html.slice(pane.index).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new BguSourceError('bgu_schedule_unrecognized');
  const info = [...html.matchAll(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/gi)]
    .find((match) => /(?:MainContent|ContentPlaceHolderMain)_divGroupInfo$/.test(attributes(` ${match[1]}`).id ?? ''));
  const teacherName = info ? htmlText(info[2]) : '';
  const from = toDateKey(startOfWeek(week)), to = toDateKey(addDays(startOfWeek(week), 6));
  const lessons = [];
  let dates;
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cell[1]);
    if (!dates) {
      dates = cells.slice(1).map((cell) => russianDate(htmlText(cell)));
      if (dates.length !== 7 || dates.some((date) => !date)) throw new BguSourceError('bgu_teacher_dates_unrecognized');
      if (dates[0] !== from || dates[6] !== to) throw new BguSourceError('bgu_teacher_week_mismatch');
      continue;
    }
    if (cells.length !== 8) throw new BguSourceError('bgu_row_unrecognized');
    const slot = timing(htmlText(cells[0]));
    for (let day = 0; day < 7; day += 1) {
      const cell = cells[day + 1];
      if (!htmlText(cell)) continue;
      const blocks = [...cell.matchAll(/<small\b[^>]*>([\s\S]*?)<\/small>\s*<h5\b[^>]*>([\s\S]*?)<\/h5>([\s\S]*?)(?=<small\b|$)/gi)];
      if (!blocks.length) throw new BguSourceError('bgu_subject_unrecognized');
      for (const block of blocks) {
        const groups = [...block[3].matchAll(/<a\b[^>]*href=['"][^'"]*timetable\.aspx\?idg=(\d+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
        const room = htmlText(block[3]).match(/ауд\.\s*([^,]+?)(?:\s+гр\.|$)/i)?.[1]?.trim();
        lessons.push({ id: `${teacherId}:${dates[day]}:${slot.lessonNumber}:${lessons.length}`, date: dates[day], ...slot,
          subject: htmlText(block[2]), lessonType: lessonType(htmlText(block[1])), subgroup: null,
          teachers: teacherName ? [teacherName] : [], teacherIds: [teacherId], auditories: room ? [room] : [], auditoryIds: [],
          groups: groups.map((item) => htmlText(item[2]).replace(/^гр\.\s*/i, '')), groupIds: groups.map((item) => Number(item[1])),
          comment: '', link: '', sourceType: 'bgu_html', transferred: false });
      }
    }
  }
  if (!dates) throw new BguSourceError('bgu_schedule_unrecognized');
  const parity = htmlText(html).match(/Неделя\s*-?\s*(нечетная|нечётная|четная|чётная)/i);
  if (!parity) throw new BguSourceError('bgu_parity_unrecognized');
  return { weekEven: !parity[1].toLowerCase().startsWith('не'), lessons: lessons.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber) };
};
export const parseTeachers = (html) => {
  const teachers = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=['"]\?idp=(\d+)['"][^>]*>([\s\S]*?)<\/a>/gi)) {
    const fullName = htmlText(match[2]);
    if (fullName) teachers.set(Number(match[1]), { id: Number(match[1]), name: fullName, fullName });
  }
  if (!teachers.size) throw new BguSourceError('bgu_directory_unrecognized');
  return [...teachers.values()];
};
export const parseSchedule = (html, { week = new Date(), groupId, teacherId } = {}) => {
  if (/расписание\s+занятий\s+временно\s+недоступно/iu.test(htmlText(html))) throw new BguSourceError('bgu_temporarily_unavailable');
  if (teacherId) return parseTeacherTable(html, { week, teacherId });
  const container = [...html.matchAll(/<div\b[^>]*>/gi)].find((match) => /^(?:MainContent|ContentPlaceHolderMain)_divTT$/.test(attributes(match[0]).id ?? ''));
  if (!container) throw new BguSourceError('bgu_schedule_unrecognized');
  const area = html.slice(container.index).split(/<footer\b/i)[0];
  if (!/<table\b/i.test(area)) throw new BguSourceError('bgu_schedule_unrecognized');
  const anchor = parseParity(html);
  const from = startOfWeek(week);
  const delta = Math.round((from - startOfWeek(new Date(`${anchor.date}T00:00:00Z`))) / 604800000);
  const weekEven = Math.abs(delta) % 2 ? !anchor.weekEven : anchor.weekEven;
  const periods = new Map([...area.matchAll(/<a\b[^>]*href=['"]#([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => {
    const dates = htmlText(match[2]).match(/\d{2}\.\d{2}\.\d{4}/g) ?? [];
    return [match[1], dates.map(dateKey)];
  }));
  const panes = [...area.matchAll(/<div\b[^>]*>/gi)].map((match) => ({ ...attributes(match[0]), index: match.index }))
    .filter((item) => item.class?.split(/\s+/).includes('tab-pane'));
  if (!panes.length || !periods.size) throw new BguSourceError('bgu_period_unrecognized');
  const lessons = [];
  let recognized = 0;
  for (let index = 0; index < panes.length; index += 1) {
    const pane = panes[index];
    const [begin, end] = periods.get(pane.id) ?? [];
    if (!begin || !end) throw new BguSourceError('bgu_period_unrecognized');
    const section = area.slice(pane.index, panes[index + 1]?.index);
    for (const table of section.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
      let day = null;
      let explicitDate = null;
      let columns;
      for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cell[1]);
        const labels = cells.map(htmlText);
        if (labels.some((label) => label === 'Начало')) {
          columns = { time: labels.indexOf('Начало'), subject: labels.indexOf('Предмет'), room: labels.indexOf('Аудитория'), teacher: labels.indexOf('Преподаватель'), date: labels.indexOf('Дата'), group: labels.indexOf('Группа') };
          if ([columns.time, columns.subject, columns.room, ...(teacherId ? [] : [columns.teacher])].some((column) => column < 0)) throw new BguSourceError('bgu_columns_unrecognized');
          recognized += 1;
          continue;
        }
        if (cells.length === 1) {
          const heading = labels[0].toUpperCase();
          const dayIndex = DAYS.findIndex((value) => heading.includes(value));
          day = dayIndex >= 0 ? dayIndex : null;
          explicitDate = russianDate(heading);
          continue;
        }
        if (!cells.length || labels.every((label) => !label)) continue;
        if (!columns) throw new BguSourceError('bgu_columns_unrecognized');
        const timeCell = cells[columns.time];
        const starts = htmlText(timeCell).match(/^(\d{1,2}):(\d{2})/);
        const rowDate = columns.date >= 0 ? labels[columns.date]?.match(/\d{2}\.\d{2}\.\d{4}/)?.[0] : null;
        if (rowDate) explicitDate = dateKey(rowDate);
        if (!starts || (day === null && !explicitDate)) throw new BguSourceError('bgu_row_unrecognized');
        const sourceDate = explicitDate ?? toDateKey(addDays(from, day));
        if (sourceDate < begin || sourceDate > end || sourceDate < toDateKey(from) || sourceDate > toDateKey(addDays(from, 6))) continue;
        const everyWeek = /fa-circle-o/.test(timeCell);
        const even = !everyWeek && /text-primary/.test(timeCell);
        const odd = !everyWeek && /text-danger/.test(timeCell);
        if (!everyWeek && !even && !odd && !explicitDate) throw new BguSourceError('bgu_row_parity_unrecognized');
        if ((even && !weekEven) || (odd && weekEven)) continue;
        const start = `${starts[1].padStart(2, '0')}:${starts[2]}`;
        const known = Object.entries(bguLessonTimes).find(([, time]) => time.startsWith(start));
        const minutes = Number(starts[1]) * 60 + Number(starts[2]);
        if (Number(starts[1]) > 23 || Number(starts[2]) > 59) throw new BguSourceError('bgu_time_unrecognized');
        const subjectCell = cells[columns.subject];
        const subject = htmlText(subjectCell.match(/<span\b[^>]*class=['"][^'"]*h5[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const kind = htmlText(subjectCell.match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1]
          ?? subjectCell.replace(/<span\b[^>]*class=['"][^'"]*h5[^'"]*['"][^>]*>[\s\S]*?<\/span>/i, ''));
        if (!subject) throw new BguSourceError('bgu_subject_unrecognized');
        const subgroup = htmlText(subjectCell).match(/(?:подгруппа|п\/г)\s*([12])|([12])\s*(?:-?я\s*)?подгруппа/i);
        const lessonNumber = known ? Number(known[0]) : minutes + 1000;
        lessons.push({
          id: `${groupId ?? teacherId}:${sourceDate}:${lessonNumber}:${subgroup?.[1] ?? subgroup?.[2] ?? 0}:${lessons.length}`,
          date: sourceDate, lessonNumber, time: known?.[1] ?? `${start}–${clock(minutes + 90)}`,
          endEstimated: !known, subject, lessonType: lessonType(kind),
          subgroup: Number(subgroup?.[1] ?? subgroup?.[2]) || null,
          teachers: labels[columns.teacher] ? [labels[columns.teacher]] : [], teacherIds: teacherId ? [teacherId] : [],
          auditories: labels[columns.room] ? [labels[columns.room]] : [], auditoryIds: [],
          groups: columns.group >= 0 ? [labels[columns.group]].filter(Boolean) : [], groupIds: groupId ? [groupId] : [],
          comment: '', link: '', sourceType: 'bgu_html', transferred: false,
        });
      }
    }
  }
  if (!recognized) throw new BguSourceError('bgu_schedule_unrecognized');
  return { weekEven, lessons: lessons.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber) };
};
