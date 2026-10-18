import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { IrnituClient } from '../src/irnitu/client.js';

const setup = async (t, { concurrency = 2 } = {}) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'norfly-cache-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let time = 1_800_000_000_000;
  let count = 0;
  let active = 0;
  let peak = 0;
  let version = 1;
  let failing = false;
  const pending = [];
  const server = createServer((request, response) => {
    count += 1;
    active += 1;
    peak = Math.max(active, peak);
    const current = version;
    pending.push(() => {
      active -= 1;
      response.writeHead(failing ? 503 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ version: current }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const options = { baseUrl: `http://localhost:${server.address().port}/`, cacheDir, timeoutMs: 2000, retries: 1, scheduleTtlMs: 900_000, directoryTtlMs: 10800_000, concurrency, now: () => time };
  const client = new IrnituClient(options);
  const dates = [new Date(2026, 9, 19), new Date(2026, 9, 25)];
  const request = (id = 1, extra = {}) => client.groupSchedule(id, ...dates, extra);
  const until = async (predicate) => {
    const end = Date.now() + 1000;
    while (!predicate()) {
      if (Date.now() > end) throw new Error('Ожидание запроса истекло');
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };
  return { client, options, dates, request, until, pending, count: () => count, peak: () => peak,
    advance: (ms) => { time += ms; }, version: (value) => { version = value; }, fail: () => { failing = true; } };
};

test('неделя старше 15 минут возвращает кэш сразу, фоновое обновление объединяет запросы', async (t) => {
  const f = await setup(t);
  const first = f.request();
  await f.until(() => f.count() === 1);
  f.pending.shift()();
  assert.equal((await first).version, 1);
  const oldStamp = f.client.updatedAt(await f.request());
  f.advance(899_999);
  await f.request();
  assert.equal(f.count(), 1);
  f.advance(1);
  f.version(2);
  const cached = await Promise.all(Array.from({ length: 20 }, () => f.request()));
  assert.ok(cached.every((item) => item.version === 1));
  await f.until(() => f.count() === 2);
  assert.equal(f.count(), 2);
  f.pending.shift()();
  await f.until(() => f.pending.length === 0);
  const updated = await f.request(1, { fresh: true });
  assert.equal(updated.version, 2);
  assert.notEqual(f.client.updatedAt(updated), oldStamp);
  await f.request();
  assert.equal(f.count(), 2);
});

test('перезапуск учитывает savedAt; свежий файл не запускает запрос к API', async (t) => {
  const f = await setup(t);
  const first = f.request();
  await f.until(() => f.count() === 1);
  f.pending.shift()();
  await first;
  const next = new IrnituClient(f.options);
  assert.equal((await next.groupSchedule(1, ...f.dates)).version, 1);
  assert.equal(f.count(), 1);
});

test('ошибка фонового обновления сохраняет кэш, повтор ограничен 15 минутами', async (t) => {
  const f = await setup(t);
  const first = f.request();
  await f.until(() => f.count() === 1);
  f.pending.shift()();
  await first;
  f.advance(900_000);
  f.fail();
  const refresh = f.request(1, { fresh: true });
  await f.until(() => f.count() === 2);
  f.pending.shift()();
  assert.equal((await refresh).version, 1);
  await Promise.all(Array.from({ length: 15 }, () => f.request(1, { fresh: true })));
  assert.equal(f.count(), 2);
});

test('общая очередь ограничивает одновременные запросы к разным группам', async (t) => {
  const f = await setup(t, { concurrency: 2 });
  const jobs = [1, 2, 3, 4, 5].map((id) => f.request(id));
  await f.until(() => f.pending.length === 2);
  for (let done = 0; done < 5;) {
    await f.until(() => f.pending.length > 0);
    for (const finish of f.pending.splice(0)) { finish(); done += 1; }
  }
  await Promise.all(jobs);
  assert.equal(f.count(), 5);
  assert.equal(f.peak(), 2);
});
