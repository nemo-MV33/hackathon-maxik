import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CommunityStore } from '../src/storage/community.js';

test('connects a chat and homework through the IRNITU group id', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-community-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'community.json');
  const store = new CommunityStore(filePath);

  await store.setChat(101, {
    group: { id: 478237, title: 'ИСТб-25-1' },
    headman: { userId: 12, name: 'Староста' },
  });
  await store.addHomework({
    chatId: 101,
    groupId: 478237,
    lessonDate: '2099-09-24',
    lessonTime: '10:00–11:30',
    subject: 'Тестирование',
    text: 'Подготовить пример',
  });

  assert.equal((await store.chatsForGroup(478237))[0].chatId, 101);
  assert.equal((await store.homeworkForGroup(478237))[0].text, 'Подготовить пример');
  assert.doesNotMatch(await readFile(filePath, 'utf8'), /undefined/);
});

test('keeps notices when delivery must be retried', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-community-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new CommunityStore(join(directory, 'community.json'));

  const notice = await store.addNotice({
    chatId: 101,
    groupId: 478237,
    senderId: 15,
    type: 'late',
    text: 'Буду через 15 минут',
    status: 'pending',
  });

  assert.equal(notice.status, 'pending');
  assert.ok(notice.id);
});

test('updates shared homework and keeps a personal version separate', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-community-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new CommunityStore(join(directory, 'community.json'));
  const lesson = {
    groupId: 478237,
    lessonDate: '2099-09-24',
    lessonNumber: 2,
    lessonTime: '10:00–11:30',
    subgroup: null,
    subject: 'Тестирование',
  };

  await store.upsertHomework({ ...lesson, text: 'Первая версия' });
  const updated = await store.upsertHomework({ ...lesson, text: 'Общая версия' });
  await store.setPersonalHomework(42, { ...lesson, text: 'Моя версия' });

  const shared = await store.homeworkForGroup(lesson.groupId, { from: '2099-09-01' });
  const personal = await store.homeworkForUser(lesson.groupId, 42, { from: '2099-09-01' });
  assert.equal(shared.length, 1);
  assert.equal(updated.version, 2);
  assert.equal(personal[0].sharedText, 'Общая версия');
  assert.equal(personal[0].personalText, 'Моя версия');
  assert.equal(personal[0].text, 'Моя версия');

  await store.removePersonalHomework(42, lesson);
  assert.equal((await store.homeworkForUser(lesson.groupId, 42, { from: '2099-09-01' }))[0].text, 'Общая версия');
});
