const LESSON_TIMES = {
  1: '08:15–09:45',
  2: '10:00–11:30',
  3: '11:45–13:15',
  4: '13:45–15:15',
  5: '15:30–17:00',
  6: '17:10–18:40',
  7: '18:45–20:15',
  8: '20:20–21:50',
};

const LESSON_TYPES = {
  0: 'мероприятие',
  1: 'лекция',
  2: 'практика',
  3: 'лабораторная',
  4: 'экзамен',
  5: 'зачёт',
  6: 'консультация',
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const unique = (items) => [...new Set(items.filter(Boolean))];
const ids = (value) => (Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []);

const transferSubject = (title) => {
  const quoted = clean(title).match(/«([^»]+)»/u)?.[1];
  return quoted || clean(title).replace(/^Разовый перенос\s*/iu, '');
};

const transferSubgroup = (title) => {
  const match = clean(title).match(/(\d)\s*(?:-?(?:ая|я))?\s*(?:подгруппа|п\/?г)/iu);
  return match ? Number(match[1]) : null;
};

const resolveNames = (values, directory) =>
  unique(ids(values).map((id) => directory.get(id)).filter(Boolean));

const lessonFromRegular = (item, dictionaries) => ({
  id: String(item.id),
  date: item.dt,
  lessonNumber: Number(item.para),
  time: LESSON_TIMES[item.para] ?? '',
  subject: clean(item.title),
  lessonType: LESSON_TYPES[item.nt] ?? 'занятие',
  subgroup: Number(item.ngroup) || null,
  teachers: resolveNames(item.teachers_ids, dictionaries.teachers),
  teacherIds: ids(item.teachers_ids),
  auditories: unique([
    clean(item.auditories_verbose),
    ...resolveNames(item.auditories_ids, dictionaries.auditories),
  ]),
  auditoryIds: ids(item.auditories_ids),
  groups: resolveNames(item.groups, dictionaries.groups),
  groupIds: ids(item.groups),
  comment: clean(item.comment),
  link: clean(item.link),
  sourceType: item.type,
  transferred: false,
});

const lessonFromTransfer = (query, scheduleItem, dictionaries) => ({
  id: String(query.id),
  date: query.dt,
  lessonNumber: Number(query.para),
  time: LESSON_TIMES[query.para] ?? '',
  subject: transferSubject(query.title),
  lessonType: LESSON_TYPES[scheduleItem?.nt] ?? 'перенос',
  subgroup: transferSubgroup(query.title),
  teachers: resolveNames(query.teachers, dictionaries.teachers),
  teacherIds: ids(query.teachers),
  auditories: resolveNames(query.auds, dictionaries.auditories),
  auditoryIds: ids(query.auds),
  groups: resolveNames(query.groups, dictionaries.groups),
  groupIds: ids(query.groups),
  comment: clean(query.title),
  link: '',
  sourceType: 'query',
  transferred: true,
});

const belongsToGroup = (lesson, groupId) => {
  if (!groupId || lesson.groupIds.length === 0) return true;
  return lesson.groupIds.includes(Number(groupId));
};

const belongsToSubgroup = (lesson, subgroup) => {
  if (!subgroup || !lesson.subgroup) return true;
  return lesson.subgroup === Number(subgroup);
};

const mergeLessons = (lessons) => {
  const merged = new Map();
  for (const lesson of lessons) {
    const key = [lesson.date, lesson.lessonNumber, lesson.subject, lesson.lessonType, lesson.subgroup].join('|');
    const current = merged.get(key);
    if (!current) {
      merged.set(key, lesson);
      continue;
    }
    current.teachers = unique([...current.teachers, ...lesson.teachers]);
    current.teacherIds = unique([...current.teacherIds, ...lesson.teacherIds]);
    current.auditories = unique([...current.auditories, ...lesson.auditories]);
    current.auditoryIds = unique([...current.auditoryIds, ...lesson.auditoryIds]);
    current.groups = unique([...current.groups, ...lesson.groups]);
    current.groupIds = unique([...current.groupIds, ...lesson.groupIds]);
  }
  return [...merged.values()];
};

export const normalizeSchedule = (payload, dictionaries, options = {}) => {
  const queries = new Map((payload.queries ?? []).map((query) => [Number(query.id), query]));
  const regular = [];
  const transferScheduleItems = new Map();

  for (const item of payload.schedule ?? []) {
    if (item.type === 'query') {
      transferScheduleItems.set(Number(item.id), item);
      continue;
    }
    if (!item.dt || !item.title) continue;
    regular.push(lessonFromRegular(item, dictionaries));
  }

  const incomingTransfers = [...queries.values()]
    .filter((query) => [2, 4].includes(Number(query.type)))
    .filter((query) => query.status == null || Number(query.status) === 1)
    .filter((query) => query.dt && query.para)
    .map((query) => lessonFromTransfer(query, transferScheduleItems.get(Number(query.id)), dictionaries));

  const lessons = mergeLessons([...regular, ...incomingTransfers])
    .filter((lesson) => belongsToGroup(lesson, options.groupId))
    .filter((lesson) => belongsToSubgroup(lesson, options.subgroup))
    .sort((left, right) =>
      left.date.localeCompare(right.date) || left.lessonNumber - right.lessonNumber,
    );

  return {
    weekEven: Number(payload.week_even) === 1,
    lessons,
  };
};

export const lessonTimes = LESSON_TIMES;
