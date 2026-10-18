import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BguProvider } from '../src/universities/bgu/provider.js';
import { UniversityService } from '../src/universities/service.js';
import { addDays, parseDateKey, startOfWeek, toDateKey } from '../src/lib/date.js';
import { lessonInTimeZone, zonedDateKey } from '../src/lib/timezone.js';

// Отдельная сетевая проверка: не входит в npm test, не читает профили и не меняет рабочий кэш.
const requested = process.argv[2] ?? zonedDateKey(new Date(), 'Asia/Irkutsk');
const date = parseDateKey(requested);
if (!date) throw new Error('Ожидалась дата YYYY-MM-DD');
const week = startOfWeek(date);
const cacheDir = await mkdtemp(join(tmpdir(), 'norfly-bgu-check-'));
try {
  const service = new UniversityService({ bgu: new BguProvider({ cacheDir }) });
  const groups = await service.groups('bgu');
  const checked = [];
  const inspect = (label, schedule) => {
    if (schedule.stale) throw new Error(`${label}: источник вернул только сохранённые данные`);
    if (!schedule.updatedAt) throw new Error(`${label}: нет времени обновления`);
    checked.push({ entity: label, from: toDateKey(schedule.period.from), updatedAt: schedule.updatedAt,
      stale: schedule.stale, lessons: schedule.lessons.length,
      assessments: schedule.lessons.filter((lesson) => ['экзамен', 'зачёт', 'консультация'].includes(lesson.lessonType)).length });
  };
  for (const title of ['ГМУ-25-1', 'БИ-26-1', 'ЗНБ-23-1']) {
    const group = groups.find((item) => item.title === title);
    if (!group) throw new Error(`В справочнике больше нет группы ${title}`);
    const schedule = await service.groupSchedule(group.id, { week, fresh: true });
    inspect(`${title} (${group.id})`, schedule);
    if (title === 'ГМУ-25-1' && schedule.lessons[0]) {
      const local = lessonInTimeZone(schedule.lessons[0], 'Europe/Moscow');
      checked[checked.length - 1].example = { university: local.universityTime, Moscow: local.time };
    }
  }
  const teacher = (await service.searchTeachers('Хаитов Григорий Александрович', { universityId: 'bgu' }))[0];
  if (!teacher) throw new Error('Преподаватель не найден');
  for (const target of [week, addDays(week, 7)]) inspect(`${teacher.fullName} (${teacher.id})`,
    await service.teacherSchedule(teacher.id, { week: target, fresh: true }));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), groups: groups.length, checked }, null, 2));
} catch (error) {
  console.error(`Проверка БГУ не пройдена: ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
