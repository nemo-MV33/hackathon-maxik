import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceCache } from '../webapp/src/lib/resource-cache.mjs';

test('request cache deduplicates pending loads and expires from successful completion', async () => {
  let now = 0; let calls = 0; let finish;
  const cache = new ResourceCache(100, () => now);
  const load = () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); };
  const a = cache.get('group-a', load); const b = cache.get('group-a', load);
  await Promise.resolve(); assert.equal(calls, 1);
  now = 200; assert.equal(cache.get('group-a', load), a);
  finish('ready'); assert.equal(await a, 'ready'); assert.equal(await b, 'ready');
  now = 250; assert.equal(await cache.get('group-a', load), 'ready'); assert.equal(calls, 1);
  now = 301; const fresh = cache.get('group-a', async () => 'new'); assert.equal(await fresh, 'new');
});

test('request cache separates users/groups and invalidation does not resurrect a stale request', async () => {
  const cache = new ResourceCache(); let finish;
  const old = cache.get('user-a:group-a', () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve(); cache.clear();
  assert.equal(await cache.get('user-b:group-a', async () => 'private-b'), 'private-b');
  assert.equal(await cache.get('user-a:group-a', async () => 'updated-a'), 'updated-a');
  finish('old-a'); assert.equal(await old, 'old-a');
  assert.equal(await cache.get('user-a:group-a', async () => 'wrong'), 'updated-a');
});

test('request cache retries failures and an obsolete failure does not discard a newer value', async () => {
  const cache = new ResourceCache();
  await assert.rejects(cache.get('key', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cache.get('key', async () => 'recovered'), 'recovered');
  cache.clear(); let fail;
  const old = cache.get('key', () => new Promise((_, reject) => { fail = reject; }));
  await Promise.resolve(); cache.clear();
  assert.equal(await cache.get('key', async () => 'fresh'), 'fresh');
  fail(new Error('old-offline')); await assert.rejects(old, /old-offline/);
  assert.equal(await cache.get('key', async () => 'wrong'), 'fresh');
});
