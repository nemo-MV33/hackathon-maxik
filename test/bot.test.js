import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBot } from '../src/bot/create-bot.js';
import { parseCommand } from '../src/bot/commands.js';
import { addDays, startOfWeek, toDateKey } from '../src/lib/date.js';
import { CommunityStore } from '../src/storage/community.js';
import { PreferencesStore } from '../src/storage/preferences.js';

const BOT = { user_id: 900, username: 't692_hakaton_max_bot', name: 'norfly' };
const STUDENT = { user_id: 1, name: 'Аня Петрова' };
const ADMIN = { user_id: 2, name: 'Олег Админ' };
const HEADMAN = { user_id: 3, name: 'Маша Староста' };
const PRIVATE_CHAT = (user) => ({ chat_id: 10_000 + user.user_id, chat_type: 'dialog' });
const GROUP_CHAT = { chat_id: -500, chat_type: 'chat' };

const GROUPS = [
  { id: 11, title: 'ИСТб-25-1', institute: 'Институт информационных технологий', course: 1 },
  { id: 12, title: 'ИСТб-25-2', institute: 'Институт информационных технологий', course: 1 },
  { id: 21, title: 'ЭЭб-24-1', institute: 'Энергетический институт', course: 2 },
];
const TEACHERS = [{ id: 31, name: 'Иванова А. П.', fullName: 'Иванова Анна Петровна' }];
const AUDITORIES = [{ id: 41, title: 'Ж-301' }];

const lessonsFor = (week) => {
  const monday = startOfWeek(week);
  return Array.from({ length: 6 }, (_, day) => toDateKey(addDays(monday, day))).flatMap((date) => [
    { date, lessonNumber: 1, time: '08:15–09:45', subject: 'Математический анализ', lessonType: 'лекция', subgroup: null, teachers: ['Иванова Анна Петровна'], auditories: ['Ж-301'], groups: ['ИСТб-25-1'] },
    { date, lessonNumber: 3, time: '11:45–13:15', subject: 'Программирование', lessonType: 'лабораторная', subgroup: 1, teachers: ['Петров С. В.'], auditories: ['В-204'], groups: ['ИСТб-25-1'] },
    { date, lessonNumber: 3, time: '11:45–13:15', subject: 'Физика', lessonType: 'лабораторная', subgroup: 2, teachers: ['Сидоров К. Л.'], auditories: ['Ж-115'], groups: ['ИСТб-25-1'] },
  ]);
};

const schedule = (kind) => async (id, { week = new Date(), subgroup } = {}) => {
  const from = startOfWeek(week);
  return {
    kind, entityId: id, period: { from, to: addDays(from, 6) }, weekEven: true,
    lessons: lessonsFor(week).filter((lesson) => !subgroup || !lesson.subgroup || lesson.subgroup === subgroup),
  };
};

const includes = (value, query) => value.toLowerCase().replace(/[\s-]/g, '').includes(query.toLowerCase().replace(/[\s-]/g, ''));

const service = {
  groups: async () => GROUPS,
  teachers: async () => TEACHERS,
  auditories: async () => AUDITORIES,
  institutes: async () => [...new Set(GROUPS.map((group) => group.institute))].sort(),
  searchGroups: async (query, { institute, course } = {}) => GROUPS
    .filter((group) => (!institute || group.institute === institute) && (!course || group.course === course))
    .filter((group) => !query || includes(group.title, query)),
  searchTeachers: async (query) => TEACHERS.filter((item) => includes(item.fullName, query)),
  searchAuditories: async (query) => AUDITORIES.filter((item) => includes(item.title, query)),
  groupSchedule: schedule('group'),
  teacherSchedule: schedule('teacher'),
  auditorySchedule: schedule('auditory'),
};

const setup = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'norfly-bot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preferences = new PreferencesStore(join(directory, 'preferences.json'));
  const community = new CommunityStore(join(directory, 'community.json'));
  const sent = [];
  const make = () => {
    const bot = createBot({ token: 'test', service, preferences, community });
    bot.botInfo = BOT;
    bot.catch((error) => { throw error; });
    Object.assign(bot.api, {
      sendMessageToChat: async (chatId, text, extra = {}) => { sent.push({ to: 'chat', chatId, text, extra }); return {}; },
      sendMessageToUser: async (id, text, extra = {}) => { sent.push({ to: 'user', userId: id, text, extra }); return {}; },
      answerOnCallback: async (callbackId, extra = {}) => {
        sent.push({ to: 'callback', text: extra.message?.text ?? extra.notification, extra: extra.message ?? {}, notification: extra.notification });
        return {};
      },
      getChatAdmins: async () => ({ members: [{ user_id: ADMIN.user_id, is_admin: true }] }),
      getChat: async () => ({ title: 'ИСТб-25-1 общий' }),
    });
    return bot;
  };
  let bot = make();
  let clock = 0;

  const run = async (update) => {
    const before = sent.length;
    await bot.handleUpdate({ timestamp: (clock += 1), ...update });
    const replies = sent.slice(before);
    for (const reply of replies) {
      assert.doesNotMatch(reply.text ?? '', /undefined|null|NaN|\[object/, `broken text: ${reply.text}`);
      for (const row of reply.extra.attachments?.[0]?.payload?.buttons ?? []) {
        for (const item of row) assert.doesNotMatch(item.text, /undefined|null|NaN/, `broken button: ${item.text}`);
      }
    }
    return replies;
  };
  const say = (user, text, { chat = PRIVATE_CHAT(user), reply, markup } = {}) => run({
    update_type: 'message_created',
    message: {
      sender: user, recipient: chat,
      body: { mid: `m${clock}`, text, ...(markup ? { markup } : {}) },
      ...(reply ? { link: { type: 'reply', sender: reply } } : {}),
    },
  });
  const press = (user, payload, { chat = PRIVATE_CHAT(user) } = {}) => run({
    update_type: 'message_callback',
    callback: { callback_id: `c${clock}`, payload, user },
    message: { recipient: chat, body: { mid: 'menu', text: '' } },
  });
  const buttons = (reply) => (reply.extra.attachments?.[0]?.payload?.buttons ?? []).flat();
  const payloads = (reply) => buttons(reply).map((item) => item.payload).filter(Boolean);
  const restart = () => { bot = make(); };

  return { run, say, press, payloads, buttons, restart, preferences, community, sent };
};

test('parseCommand понимает упоминание бота, регистр и аргументы', () => {
  const opts = { botId: BOT.user_id, botUsername: BOT.username };
  const message = (text, markup) => ({ body: { text, markup } });
  assert.deepEqual(parseCommand(message('/today'), opts), { name: 'today', args: '' });
  assert.deepEqual(parseCommand(message('/today@t692_hakaton_max_bot'), opts), { name: 'today', args: '' });
  assert.deepEqual(parseCommand(message('/Find  ИСТб-25-1 '), opts), { name: 'find', args: 'ИСТб-25-1' });
  assert.deepEqual(parseCommand(message('@t692_hakaton_max_bot /week'), opts), { name: 'week', args: '' });
  assert.deepEqual(parseCommand(message('norfly /week', [{ type: 'user_mention', from: 0, length: 6, user_id: BOT.user_id }]), opts), { name: 'week', args: '' });
  assert.equal(parseCommand(message('/today@other_bot'), opts), null);
  assert.equal(parseCommand(message('просто текст'), opts), null);
});

test('первый запуск: язык, поиск группы, подгруппа, расписание', async (t) => {
  const { run, say, press, payloads, preferences } = await setup(t);

  const [prompt] = await run({ update_type: 'bot_started', chat_id: PRIVATE_CHAT(STUDENT).chat_id, user: STUDENT });
  assert.match(prompt.text, /Choose language/);
  assert.deepEqual(payloads(prompt), ['lang:ru', 'lang:en']);

  const [welcome] = await press(STUDENT, 'lang:en');
  assert.equal(welcome.to, 'callback');
  assert.match(welcome.text, /Send me your group name/);

  const [results] = await say(STUDENT, 'истб 25');
  assert.deepEqual(payloads(results).filter((p) => p.startsWith('mine:')), ['mine:11', 'mine:12']);

  const [subgroup] = await press(STUDENT, 'mine:11');
  assert.deepEqual(payloads(subgroup), ['sub:11:1', 'sub:11:2', 'sub:11:all']);

  const [day] = await press(STUDENT, 'sub:11:1');
  assert.match(day.text, /ИСТб-25-1/);
  assert.match(day.text, /Today/);
  assert.match(day.text, /Программирование/);
  assert.doesNotMatch(day.text, /Физика/, 'чужая подгруппа не показывается');
  assert.match(day.text, /lab/, 'тип пары переведён');

  const saved = await preferences.get(STUDENT.user_id);
  assert.equal(saved.lang, 'en');
  assert.equal(saved.subgroup, 1);
  assert.equal(saved.selection.id, 11);
});

test('выбор группы через институт и курс', async (t) => {
  const { say, press, payloads } = await setup(t);
  await press(STUDENT, 'lang:ru');
  const [institutes] = await press(STUDENT, 'inst:0');
  assert.ok(payloads(institutes).includes('crs:0'));
  const [courses] = await press(STUDENT, 'crs:0');
  assert.ok(payloads(courses).some((p) => p.startsWith('grp:0:1:')));
  const [groups] = await press(STUDENT, 'grp:0:1:0');
  assert.ok(payloads(groups).includes('mine:11'));
  const [menu] = await say(STUDENT, '/start');
  assert.match(menu.text, /Напиши название своей группы/);
});

test('команды с упоминанием бота и неизвестные команды', async (t) => {
  const { say, press, payloads } = await setup(t);
  await press(STUDENT, 'lang:ru');
  await press(STUDENT, 'sub:11:all');

  const [today] = await say(STUDENT, '/today@t692_hakaton_max_bot');
  assert.match(today.text, /Сегодня/);
  const [week] = await say(STUDENT, '@t692_hakaton_max_bot /WEEK');
  assert.match(week.text, /неделя/);
  assert.ok(payloads(week).includes('s:group:11:w1'));
  const [unknown] = await say(STUDENT, '/foo');
  assert.match(unknown.text, /Такой команды нет/);
  const [alias] = await say(STUDENT, '/schedule');
  assert.match(alias.text, /ИСТб-25-1/);

  assert.deepEqual(await say(ADMIN, '/today@other_bot', { chat: GROUP_CHAT }), []);
  assert.deepEqual(await say(ADMIN, '/foo', { chat: GROUP_CHAT }), [], 'чужие команды в группе игнорируются');
  const [addressed] = await say(ADMIN, '/foo@t692_hakaton_max_bot', { chat: GROUP_CHAT });
  assert.match(addressed.text, /Такой команды нет/);
});

test('кнопки работают после перезапуска бота', async (t) => {
  const { press, restart } = await setup(t);
  await press(STUDENT, 'lang:ru');
  await press(STUDENT, 'sub:11:2');
  restart();
  const [nextWeek] = await press(STUDENT, 's:group:11:w1');
  assert.match(nextWeek.text, /Физика/);
  assert.doesNotMatch(nextWeek.text, /Программирование/);
  const [teacher] = await press(STUDENT, 's:teacher:31:d0');
  assert.match(teacher.text, /Иванова Анна Петровна/);
});

test('поиск преподавателя и аудитории, чужая группа', async (t) => {
  const { say, press, payloads } = await setup(t);
  await press(STUDENT, 'lang:ru');
  await press(STUDENT, 'sub:11:all');
  const [teacher] = await say(STUDENT, '/find иванова');
  assert.match(teacher.text, /Иванова Анна Петровна/, 'единственное совпадение открывается сразу');
  const [room] = await say(STUDENT, 'ж-301');
  assert.match(room.text, /Ж-301/);
  const [several] = await say(STUDENT, 'ИСТб-25');
  assert.deepEqual(payloads(several).filter((p) => p.startsWith('s:')), ['s:group:11:d0', 's:group:12:d0']);
  const [other] = await press(STUDENT, 's:group:21:d0');
  assert.ok(payloads(other).includes('mine:21'), 'чужую группу можно сделать своей');
  const [nothing] = await say(STUDENT, 'абракадабра');
  assert.match(nothing.text, /ничего не нашёл/);
});

test('чат группы: настройка, староста, редактор, ДЗ, доступ', async (t) => {
  const { run, say, press, payloads, community } = await setup(t);
  const inGroup = { chat: GROUP_CHAT };

  const [welcome] = await run({ update_type: 'bot_added', chat_id: GROUP_CHAT.chat_id, user: ADMIN, is_channel: false });
  assert.deepEqual(payloads(welcome), ['setup']);

  const [denied] = await say(STUDENT, '/setup', inGroup);
  assert.match(denied.text, /владелец или администратор/);

  const [prompt] = await say(ADMIN, '/setup', inGroup);
  assert.match(prompt.text, /Напиши название группы/);
  const [results] = await say(ADMIN, 'ИСТб-25', inGroup);
  assert.ok(payloads(results).includes('link:11'));
  const [subgroups] = await press(ADMIN, 'link:11', inGroup);
  assert.ok(payloads(subgroups).includes('lsub:11:all'));
  const [linked] = await press(ADMIN, 'lsub:11:all', inGroup);
  assert.match(linked.text, /привязан к группе/);
  assert.equal((await community.getChat(GROUP_CHAT.chat_id)).group.id, 11);

  const [forbidden] = await say(STUDENT, '/add', inGroup);
  assert.match(forbidden.text, /староста и редакторы/);

  const [hint] = await say(ADMIN, '/headman', inGroup);
  assert.match(hint.text, /Ответь командой \/headman/);
  const [headman] = await say(ADMIN, '/headman', { ...inGroup, reply: HEADMAN });
  assert.match(headman.text, /Маша Староста/);

  const [notHeadman] = await say(ADMIN, '/editor', { ...inGroup, reply: STUDENT });
  assert.match(notHeadman.text, /только староста/);
  const [editor] = await say(HEADMAN, '/editor', { ...inGroup, reply: STUDENT });
  assert.match(editor.text, /Аня Петрова теперь может/);

  const [picker] = await say(STUDENT, '/add', inGroup);
  const lessonPayload = payloads(picker).find((p) => p.startsWith('gh:'));
  assert.ok(lessonPayload);
  const [textPrompt] = await press(STUDENT, lessonPayload, inGroup);
  assert.match(textPrompt.text, /Отправь текст ДЗ/);
  const [tooLong] = await say(STUDENT, 'x'.repeat(2_001), inGroup);
  assert.match(tooLong.text, /до 2000/);
  const [saved] = await say(STUDENT, 'Стр. 45, № 1–10', inGroup);
  assert.match(saved.text, /сохранено/);

  const [list] = await say(ADMIN, '/homework', inGroup);
  assert.match(list.text, /Стр\. 45, № 1–10/);
  const [team] = await say(ADMIN, '/team', inGroup);
  assert.match(team.text, /Маша Староста/);
  assert.match(team.text, /Аня Петрова/);

  const [access] = await say(HEADMAN, '/access', inGroup);
  assert.deepEqual(payloads(access), ['acc:editors', 'acc:all']);
  const [notAllowed] = await press(STUDENT, 'acc:all', inGroup);
  assert.ok(notAllowed.notification);
  await press(HEADMAN, 'acc:all', inGroup);
  assert.equal((await community.getChat(GROUP_CHAT.chat_id)).homeworkMode, 'all');

  const [language] = await say(ADMIN, '/language en', inGroup);
  assert.match(language.text, /Group chat commands/);
  const [english] = await say(STUDENT, '/today', inGroup);
  assert.match(english.text, /Today/);
});

test('личная версия ДЗ, сообщение старосте, настройки', async (t) => {
  const { say, press, payloads, community, sent } = await setup(t);
  const inGroup = { chat: GROUP_CHAT };
  await say(ADMIN, '/setup ИСТб-25-1', inGroup);
  await press(ADMIN, 'lsub:11:all', inGroup);
  await say(ADMIN, '/headman', { ...inGroup, reply: HEADMAN });

  await press(STUDENT, 'lang:ru');
  await press(STUDENT, 'sub:11:1');

  const [picker] = await say(STUDENT, '/add');
  const lesson = payloads(picker).find((p) => p.startsWith('ph:'));
  assert.ok(lesson);
  await press(STUDENT, lesson);
  const [saved] = await say(STUDENT, 'Решить вариант 3');
  assert.match(saved.text, /Твоя версия/);
  const [list] = await say(STUDENT, '/homework');
  assert.match(list.text, /Решить вариант 3/);
  assert.match(list.text, /твоя версия/);

  const [again] = await press(STUDENT, lesson);
  const reset = payloads(again).find((p) => p.startsWith('phr:'));
  assert.ok(reset, 'можно удалить свою версию');
  await press(STUDENT, reset);
  assert.equal((await community.homeworkForUser(11, STUDENT.user_id)).length, 0);

  const [absence] = await say(STUDENT, '/absence');
  assert.deepEqual(payloads(absence), ['abs:late', 'abs:absent', 'cancel']);
  await press(STUDENT, 'abs:late');
  const before = sent.length;
  const replies = await say(STUDENT, 'Автобус сломался, буду к 9:00');
  assert.match(replies.find((item) => item.to === 'chat').text, /Отправил старосте/);
  const toHeadman = sent.slice(before).find((item) => item.to === 'user');
  assert.equal(toHeadman.userId, HEADMAN.user_id);
  assert.match(toHeadman.text, /Опоздание · ИСТб-25-1/);
  assert.doesNotMatch(toHeadman.text, /Аня/, 'сообщение анонимное');

  const [settings] = await say(STUDENT, '/settings');
  assert.match(settings.text, /Напоминания за 15 минут до пары: включены/);
  const [off] = await press(STUDENT, 'set:rem');
  assert.match(off.text, /выключены/);
  const [english] = await press(STUDENT, 'set:lang');
  assert.match(english.text, /Language: English/);
  const [cancelled] = await say(STUDENT, '/absence');
  assert.ok(cancelled.text);
  const [cancel] = await press(STUDENT, 'cancel');
  assert.match(cancel.text, /Cancelled/);
});
