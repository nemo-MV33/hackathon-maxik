import { alertAdministrator } from '../src/backup/alert.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { backup, restoreLatest, retentionKeys, prepareBackup } from '../src/backup/service.js';
import { restoreArchive } from '../src/backup/archive.js';
import { ObjectStorage } from '../src/backup/object-storage.js';

const setup = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'norfly-backup-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); await mkdir(join(source, 'attachments'), { recursive: true }); await mkdir(join(source, 'data'));
  await writeFile(join(source, 'data', 'community.json'), JSON.stringify({ homework: [{ text: 'ДЗ', attachments: [{ id: 'photo' }] }], personalHomework: [{ text: 'Личное' }], chats: { 1: {} } }));
  await writeFile(join(source, 'data', 'schedule-snapshots.json'), JSON.stringify({ schemaVersion: 2, groups: { 11: { lessons: [1, 2, 3] } } }));
  await writeFile(join(source, 'attachments', 'photo'), randomBytes(2 * 1024 * 1024));
  const objects = new Map();
  const storage = { put: async (name, path) => objects.set(name, await readFile(path)), get: async (name, path) => writeFile(path, objects.get(name)), list: async (prefix) => [...objects.keys()].filter((name) => name.startsWith(prefix)), delete: async (name) => objects.delete(name) };
  return { root, objects, storage, key: randomBytes(32).toString('hex'), capture: async (destination) => { await cp(source, destination, { recursive: true }); return '2026-10-18T10:00:00.000Z'; } };
};
test('backup encrypts before upload, restores all files, verifies hashes and record counts', async (t) => {
  const options = await setup(t); const start = performance.now();
  const result = await backup(options);
  assert.equal(result.ok, true); assert.equal(result.files, 3);
  const encrypted = [...options.objects.values()][0]; assert.equal(encrypted.includes(Buffer.from('Личное')), false);
  const report = await restoreLatest({ ...options, destination: join(options.root, 'restored') });
  assert.equal(report.verified, true); assert.equal(report.counts['data/community.json'].homework, 1); assert.equal(report.counts['data/community.json'].personalHomework, 1);
  assert.equal(report.counts['data/schedule-snapshots.json'].groups, 1);
  assert.equal((await readFile(join(options.root, 'restored', 'attachments', 'photo'))).length, 2 * 1024 * 1024);
  await assert.rejects(restoreLatest({ ...options, destination: join(options.root, 'restored') }), /restore_destination_not_empty/);
  console.log(JSON.stringify({ recoveryDrill: true, fixtureBytes: 2 * 1024 * 1024, archiveBytes: encrypted.length, restoreMs: report.totalDurationMs, backupAndRestoreMs: Math.round(performance.now() - start), counts: report.counts }));
});
test('wrong encryption key and changed ciphertext fail before extraction', async (t) => {
  const options = await setup(t); await backup(options);
  await assert.rejects(restoreLatest({ ...options, key: randomBytes(32).toString('hex'), destination: join(options.root, 'wrong') }));
  const [name, bytes] = [...options.objects][0]; bytes[50] ^= 1; options.objects.set(name, bytes);
  await assert.rejects(restoreLatest({ ...options, destination: join(options.root, 'corrupt') }));
});
test('restore accepts authenticated tar padding and still verifies extracted bytes', async (t) => {
  const options = await setup(t); await backup(options);
  const encrypted = [...options.objects.values()][0];
  const key = Buffer.from(options.key, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(8, 20));
  decipher.setAAD(encrypted.subarray(0, 8)); decipher.setAuthTag(encrypted.subarray(-16));
  const archive = gunzipSync(Buffer.concat([decipher.update(encrypted.subarray(20, -16)), decipher.final()]));
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(encrypted.subarray(0, 8));
  const padded = gzipSync(Buffer.concat([archive, Buffer.alloc(2 * 1024 * 1024)]));
  const path = join(options.root, 'padded.enc');
  await writeFile(path, Buffer.concat([encrypted.subarray(0, 8), nonce, cipher.update(padded), cipher.final(), cipher.getAuthTag()]));
  const result = await restoreArchive(path, join(options.root, 'padded-restore'), options.key);
  assert.equal(result.verified, true); assert.equal(result.files, 3);
  assert.deepEqual(await readFile(join(options.root, 'padded-restore', 'attachments', 'photo')), await readFile(join(options.root, 'source', 'attachments', 'photo')));
});
test('rotation keeps 14 daily and 8 weekly recovery points; unrelated keys untouched', () => {
  const keys = Array.from({ length: 100 }, (_, index) => `norfly/${new Date(Date.UTC(2026, 6, index + 1)).toISOString().replace(/[:.]/g, '-')}.enc`);
  keys.push('norfly/manual.enc', 'norfly/notes');
  const deleted = retentionKeys(keys); const kept = keys.filter((name) => !deleted.includes(name));
  for (const name of keys.slice(86, 100)) assert.ok(kept.includes(name));
  assert.ok(kept.length >= 20 && kept.length <= 24); assert.ok(kept.includes('norfly/manual.enc'));
  assert.throws(() => retentionKeys(keys, { daily: 0 }), /invalid_retention/);
});
test('upload or read-back failure alerts administrator, records status, never rotates good copies', async (t) => {
  for (const stage of ['put', 'get']) {
    const options = await setup(t); const alerts = []; let deleted = false;
    options.storage[stage] = async () => { throw new Error('storage_unavailable'); };
    options.storage.delete = async () => { deleted = true; };
    const statusPath = join(options.root, 'last-backup.json');
    await assert.rejects(backup({ ...options, statusPath, notify: async (text) => alerts.push(text) }), /storage_unavailable/);
    assert.equal(alerts.length, 1); assert.equal(deleted, false); assert.equal(JSON.parse(await readFile(statusPath)).ok, false);
  }
});
test('storage signs HTTPS requests and paginates XML with escaped continuation token', async () => {
  const calls = []; let page = 0;
  const storage = new ObjectStorage({ bucket: 'norfly-test', accessKeyId: 'id', secretAccessKey: 'secret', fetchImpl: async (url, options) => {
    calls.push({ url, options }); page += 1;
    return new Response(page === 1 ? '<ListBucketResult><Key>norfly/a.enc</Key><IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b</NextContinuationToken></ListBucketResult>' : '<ListBucketResult><Key>norfly/b.enc</Key><IsTruncated>false</IsTruncated></ListBucketResult>');
  } });
  assert.deepEqual(await storage.list('norfly/'), ['norfly/a.enc', 'norfly/b.enc']);
  assert.match(calls[1].url, /continuation-token=a%26b/); assert.match(calls[0].options.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.throws(() => new ObjectStorage({ bucket: 'bucket', accessKeyId: 'id', secretAccessKey: 'secret', endpoint: 'http://example.com' }), /requires_https/);
});

test('quiesced source is archived without copying plaintext and uploads through the prepared path', async (t) => {
  const options = await setup(t); const workspace = join(options.root, 'work'); await mkdir(workspace);
  const prepared = await prepareBackup({ root: join(options.root, 'source'), archive: join(workspace, 'backup.enc'), key: options.key, snapshotAt: '2026-10-18T10:00:00.000Z' });
  const result = await backup({ ...options, capture: undefined, prepared }); assert.equal(result.ok, true);
  const restored = await restoreLatest({ ...options, destination: join(options.root, 'restored') }); assert.equal(restored.files, 3);
});

test('multipart upload supports full attachment quota and aborts incomplete uploads on error', async (t) => {
  const options = await setup(t); const path = join(options.root, 'large.enc'); await writeFile(path, randomBytes(6 * 1024 * 1024));
  const calls = []; let fail = false;
  const storage = new ObjectStorage({ bucket: 'norfly-test', accessKeyId: 'id', secretAccessKey: 'secret', fetchImpl: async (url, request) => {
    calls.push({ url, request });
    if (request.method === 'POST' && url.endsWith('uploads=')) return new Response('<UploadId>upload-id</UploadId>');
    if (request.method === 'PUT') return fail ? new Response('fail', { status: 503 }) : new Response('', { headers: { etag: '"abcdef"' } });
    return new Response('<CompleteMultipartUploadResult/>');
  } });
  await storage.multipart('norfly/large.enc', path, 5 * 1024 * 1024);
  assert.equal(calls.filter((call) => call.request.method === 'PUT').length, 2);
  assert.match(calls.at(-1).request.bytes?.toString() ?? calls.at(-1).request.body.toString(), /PartNumber>2/);
  fail = true; await assert.rejects(storage.multipart('norfly/fail.enc', path, 5 * 1024 * 1024), /http_503/);
  assert.equal(calls.at(-1).request.method, 'DELETE'); assert.match(calls.at(-1).url, /uploadId=upload-id/);
});

test('backup alert addresses configured MAX administrator and surfaces delivery failure', async () => {
  const sent = []; await alertAdministrator({ token: 'test', adminId: '123', text: 'Ошибка копии', send: async (...args) => sent.push(args) });
  assert.deepEqual(sent, [[123, 'Ошибка копии']]);
  await assert.rejects(alertAdministrator({ token: 'test', adminId: '' }), /not_configured/);
  await assert.rejects(alertAdministrator({ token: 'test', adminId: '123', text: 'Ошибка', send: async () => { throw new Error('max_unavailable'); } }), /max_unavailable/);
});

test('failed backup preserves last successful recovery point in atomic status file', async (t) => {
  const options = await setup(t); const statusPath = join(options.root, 'status.json');
  const saved = await backup({ ...options, statusPath });
  options.storage.put = async () => { throw new Error('unavailable'); };
  await assert.rejects(backup({ ...options, statusPath }), /unavailable/);
  const status = JSON.parse(await readFile(statusPath)); assert.equal(status.ok, false); assert.equal(status.lastSuccess.key, saved.key); assert.equal(status.lastSuccess.snapshotAt, saved.snapshotAt);
});
