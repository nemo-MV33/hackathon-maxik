import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore, detectAttachmentType, cleanFilename } from '../src/storage/attachments.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';
import { createHttpServer } from '../src/http/server.js';
import { downloadMaxAttachment, HomeworkAttachmentBatch } from '../src/bot/homework-attachments.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=', 'base64');
const lesson = { date: '2099-09-24', lessonNumber: 1, time: '08:15–09:45', subject: 'Математика', subgroup: null };
const target = { groupId: 11, lessonDate: lesson.date, lessonNumber: 1, subgroup: null, subject: lesson.subject, lessonTime: lesson.time };
const setup = async (t, limits = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-attachments-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const community = new CommunityStore(join(directory, 'community.json'));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  let now = Date.now();
  const store = new AttachmentStore(join(directory, 'files'), { community, preferences, secret: 'test', now: () => now,
    limits: { fileBytes: 1000, count: 2, groupBytes: 4000, totalBytes: 100_000, reserveBytes: 1, ...limits } });
  community.attachmentStore = store;
  await community.setChat(-1, { group: { id: 11 }, headman: { userId: 1 } });
  for (const id of [1, 2, 3]) await preferences.set(id, { selection: { kind: 'group', id: id === 3 ? 12 : 11 } });
  const upload = (bytes = PDF, values = {}) => store.upload(bytes, { userId: 1, groupId: 11, scope: 'shared', name: 'ДЗ.pdf', ...values });
  const server = createHttpServer({ community, preferences, devUserId: 1, service: { groupSchedule: async () => ({ lessons: [lesson] }) } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (body) => fetch(`${base}/api/homework`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...lesson, groupId: 11, scope: 'shared', text: '', ...body }) });
  return { directory, community, preferences, store, upload, base, put, advance: (ms) => { now += ms; } };
};

test('upload raw bytes, save text with attachments once, attachment-only, headers, signed URL and access', async (t) => {
  const { base, put, store, community, preferences, advance } = await setup(t);
  const response = await fetch(`${base}/api/attachments?scope=shared&name=..%2FДЗ.exe`, { method: 'POST', body: PDF });
  assert.equal(response.status, 201);
  const file = (await response.json()).item;
  assert.equal(file.mime, 'application/pdf');
  assert.equal(file.name.includes('/'), false);
  assert.equal((await put({ text: 'Решить задачи', attachmentIds: [file.id] })).status, 200);
  assert.equal((await put({ attachmentIds: [file.id] })).status, 200);
  const item = (await community.homeworkForGroup(11, { from: '2000-01-01' }))[0];
  assert.equal(item.text, '');
  assert.equal(item.attachments[0].id, file.id);
  assert.equal(item.history[0].added[0].id, file.id);
  assert.equal(item.history[0].by, 1);
  await store.authorize(file.id, 2);
  await assert.rejects(store.authorize(file.id, 3), { status: 403 });
  const signed = await (await fetch(`${base}/api/attachments/${file.id}/link`)).json();
  const download = await fetch(`${base}${signed.url}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), PDF);
  assert.equal((await fetch(`${base}${signed.url.replace('user=1', 'user=2')}`)).status, 403);
  await preferences.set(1, { selection: { kind: 'group', id: 12 } });
  assert.equal((await fetch(`${base}${signed.url}`)).status, 403);
  await preferences.set(1, { selection: { kind: 'group', id: 11 } });
  advance(5 * 60_000 + 1);
  assert.equal((await fetch(`${base}${signed.url}`)).status, 403);
});

test('file size, count, quota, disk reserve, content detection and traversal protection', async (t) => {
  const { store, upload, put, base } = await setup(t, { groupBytes: PDF.length * 2 + 1 });
  await assert.rejects(upload(Buffer.alloc(1001)), { status: 413 });
  await assert.rejects(upload(Buffer.from('<html>evil</html>')), { status: 415 });
  await assert.rejects(upload(Buffer.from('MZ\0\x01evil'), { name: 'photo.jpg' }), { status: 415 });
  assert.equal((await detectAttachmentType(PNG)).mime, 'image/png');
  assert.equal((await detectAttachmentType(Buffer.from('Задачи 1–5'))).mime, 'text/plain');
  assert.match(cleanFilename('../a\u202e.pdf'), /^_a/);
  assert.throws(() => store.path('../secret'), { status: 404 });
  const [a, b] = await Promise.all([upload(), upload()]);
  assert.equal((await put({ attachmentIds: [a.id, b.id, a.id] })).status, 400);
  const three = new Set([a.id, b.id, '00000000-0000-4000-8000-000000000000']);
  assert.equal((await put({ attachmentIds: [...three] })).status, 413);
  await assert.rejects(upload(), { status: 413 });
  assert.equal((await fetch(`${base}/api/attachments?scope=shared`, { method: 'POST', body: Buffer.alloc(1001) })).status, 413);
  store.limits.groupBytes = 100_000;
  store.limits.count = 100;
  store.limits.totalBytes = PDF.length;
  await assert.rejects(upload(), { status: 413 });
  store.limits.totalBytes = 100_000;
  store.limits.reserveBytes = Number.MAX_SAFE_INTEGER;
  await assert.rejects(upload(), { status: 507 });
});

test('personal files private, cannot steal pending upload or cross group/scope, removeUser deletes personal blobs', async (t) => {
  const { upload, store, community, put, base } = await setup(t);
  const personal = await upload(PDF, { scope: 'personal' });
  await assert.rejects(store.authorize(personal.id, 2), { status: 403 });
  assert.equal((await put({ attachmentIds: [personal.id] })).status, 403);
  await community.setPersonalHomework(1, { ...target, text: '', attachments: [personal] });
  await assert.rejects(store.authorize(personal.id, 2), { status: 403 });
  const pending = await upload(PDF, { userId: 2 });
  assert.equal((await put({ attachmentIds: [pending.id] })).status, 403);
  const other = await upload(PDF, { groupId: 12 });
  assert.equal((await put({ attachmentIds: [other.id] })).status, 403);
  assert.equal((await fetch(`${base}/api/me`, { method: 'DELETE' })).status, 200);
  await assert.rejects(readFile(store.path(personal.id)), { code: 'ENOENT' });
});

test('move and cancellation preserve both scopes; removal records history and retains version bytes; abandoned uploads cleaned', async (t) => {
  const { upload, store, community, advance, directory } = await setup(t);
  const shared = await upload(PNG);
  const own = await upload(PDF, { scope: 'personal' });
  await community.upsertHomework({ ...target, text: 'Задачи', attachments: [shared], authorId: 1 });
  await community.setPersonalHomework(1, { ...target, text: '', attachments: [own] });
  const to = { ...lesson, date: '2099-09-25', lessonNumber: 2 };
  await community.relocateHomework(11, lesson, to, { id: 'move' });
  await community.relocateHomework(11, to, null, { id: 'cancel' });
  const rows = await community.attachmentRecords();
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.status, 'orphaned'); assert.equal(row.attachments.length, 1); await readFile(store.path(row.attachments[0].id)); }
  const moved = { ...target, lessonDate: to.date, lessonNumber: 2 };
  const changed = await community.upsertHomework({ ...moved, text: 'Без фото', attachments: [], authorId: 1 });
  assert.equal(changed.history.findLast((event) => event.type === 'attachments').removed[0].id, shared.id);
  assert.deepEqual(await readFile(store.path(shared.id)), PNG);
  await assert.rejects(store.authorize(shared.id, 2), { status: 403 });
  await community.removeHomework(moved);
  await assert.rejects(readFile(store.path(shared.id)), { code: 'ENOENT' });
  await community.removePersonalHomework(1, moved);
  await assert.rejects(readFile(store.path(own.id)), { code: 'ENOENT' });
  const pending = await upload();
  const orphanId = '00000000-0000-4000-8000-000000000001';
  await writeFile(store.path(orphanId), PDF);
  advance(3605_000);
  await store.reconcile();
  await assert.rejects(readFile(store.path(pending.id)), { code: 'ENOENT' });
  await assert.rejects(readFile(store.path(orphanId)), { code: 'ENOENT' });
  assert.equal((await readdir(join(directory, 'files'))).length, 0);
});

test('migration adds empty attachments, version 4, is idempotent and refuses future schemas', async (t) => {
  const { directory } = await setup(t);
  const path = join(directory, 'legacy.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 3, homework: [{ ...target, text: 'Задачи' }], custom: true }));
  const store = new CommunityStore(path);
  assert.deepEqual((await store.homeworkForGroup(11, { from: '2000-01-01' }))[0].attachments, []);
  const before = await readFile(path, 'utf8');
  assert.equal(JSON.parse(before).schemaVersion, 4);
  assert.equal(JSON.parse(before).custom, true);
  await new CommunityStore(path).attachmentRecords();
  assert.equal(await readFile(path, 'utf8'), before);
  await writeFile(path, '{"schemaVersion":99}');
  await assert.rejects(new CommunityStore(path).attachmentRecords(), /Unsupported/);
});

test('series combines caption, files and text without duplicate message IDs; cancellation stops commit', async () => {
  const saved = [];
  const batch = new HomeworkAttachmentBatch({ save: async (...args) => saved.push(args), failed: assert.fail });
  await batch.add('author', { mid: '1', text: 'Задачи', attachments: [], context: {} });
  await batch.add('author', { mid: '2', text: '', attachments: [{ id: 'photo' }], context: {} });
  await batch.add('author', { mid: '2', text: '', attachments: [{ id: 'photo' }], context: {} });
  await batch.flush('author');
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1], 'Задачи');
  assert.equal(saved[0][2].length, 1);
  await batch.add('other', { mid: '3', text: '', attachments: [], context: {} });
  batch.cancel('other');
  await batch.flush('other');
  assert.equal(saved.length, 1);
});

test('MAX download bounds size and rejects external URLs or external redirects', async () => {
  const item = { payload: { url: 'https://photo.okcdn.ru/file' } };
  assert.deepEqual(await downloadMaxAttachment(item, 1000, async () => new Response(PDF)), PDF);
  await assert.rejects(downloadMaxAttachment(item, 10, async () => new Response(PDF)), { status: 413 });
  await assert.rejects(downloadMaxAttachment({ payload: { url: 'http://127.0.0.1/secret' } }, 1000), { status: 400 });
  await assert.rejects(downloadMaxAttachment(item, 1000, async () => new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } })), { status: 400 });
});


test('discard pending upload, committed deletion, signed link revocation and image inline header', async (t) => {
  const { base, upload, community, store, put } = await setup(t);
  const pending = await upload();
  assert.equal((await fetch(`${base}/api/attachments/${pending.id}`, { method: 'DELETE' })).status, 200);
  await assert.rejects(store.metadata(pending.id), { status: 404 });
  const image = await upload(PNG);
  assert.equal((await put({ text: 'Фото', attachmentIds: [image.id] })).status, 200);
  assert.equal((await fetch(`${base}/api/attachments/${image.id}`, { method: 'DELETE' })).status, 403);
  const link = await store.link(image.id, 1);
  assert.match((await fetch(`${base}${link.url}`)).headers.get('content-disposition'), /^inline;/);
  assert.equal((await put({ text: null })).status, 200);
  assert.equal((await fetch(`${base}${link.url}`)).status, 404);
  assert.equal((await community.attachmentRecords()).length, 0);
});
