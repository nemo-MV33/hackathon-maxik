import 'dotenv/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from '../src/config.js';
import { IrnituClient } from '../src/irnitu/client.js';
import { addDays, startOfWeek, toDateKey } from '../src/lib/date.js';
import { ScheduleService } from '../src/services/schedule-service.js';

const outDir = resolve(process.argv[2] ?? 'webapp/dist/data');
const cacheDir = `${outDir}-cache`;
const weeks = Number(process.env.EXPORT_WEEKS ?? 2);
const concurrency = Number(process.env.EXPORT_CONCURRENCY ?? 6);
const groupLimit = Number(process.env.EXPORT_GROUP_LIMIT ?? 0);

const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
};

const slimLesson = (lesson) => ({
  date: lesson.date,
  lessonNumber: lesson.lessonNumber,
  time: lesson.time,
  subject: lesson.subject,
  lessonType: lesson.lessonType,
  subgroup: lesson.subgroup,
  teachers: lesson.teachers,
  auditories: lesson.auditories,
  comment: lesson.comment || undefined,
  link: lesson.link || undefined,
  transferred: lesson.transferred || undefined,
});

const runPool = async (tasks, size) => {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: size }, worker));
};

const service = new ScheduleService(new IrnituClient({
  ...config.irnitu,
  cacheDir,
  retries: Math.max(config.irnitu.retries, 3),
  timeoutMs: Math.max(config.irnitu.timeoutMs, 15_000),
}));

const startedAt = Date.now();
const allGroups = await service.groups();
const groups = groupLimit > 0 ? allGroups.slice(0, groupLimit) : allGroups;
const weekStarts = Array.from({ length: weeks }, (_, index) => addDays(startOfWeek(), index * 7));

await rm(outDir, { recursive: true, force: true });
await writeJson(join(outDir, 'groups.json'), groups.map(({ id, title, institute, course }) => ({
  id, title, institute, course,
})));

let failed = 0;
const tasks = groups.flatMap((group) => weekStarts.map((week) => async () => {
  try {
    const schedule = await service.groupSchedule(group.id, { week });
    await writeJson(join(outDir, 'schedule', String(group.id), `${toDateKey(week)}.json`), {
      weekStart: toDateKey(week),
      weekEven: schedule.weekEven,
      lessons: schedule.lessons.map(slimLesson),
    });
  } catch (error) {
    failed += 1;
    console.warn(`Не удалось выгрузить ${group.title} (${toDateKey(week)}): ${error.message}`);
  }
}));

await runPool(tasks, concurrency);

await writeJson(join(outDir, 'meta.json'), {
  updatedAt: new Date().toISOString(),
  weeks: weekStarts.map(toDateKey),
  groups: groups.length,
  failed,
});
await rm(cacheDir, { recursive: true, force: true });

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`Выгружено ${tasks.length - failed}/${tasks.length} расписаний за ${seconds} с`);
if (failed > tasks.length / 2) process.exitCode = 1;
