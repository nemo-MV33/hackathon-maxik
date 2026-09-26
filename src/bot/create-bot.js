import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { addDays, toDateKey } from '../lib/date.js';
import { parseCommand } from './commands.js';
import { formatDate, formatHomework, formatScheduleDay, formatScheduleWeek } from './format.js';
import { DEFAULT_LANGUAGE, normalizeLanguage, texts } from './i18n.js';

// Кнопки несут всё нужное в payload, поэтому переживают перезапуск бота.
// В памяти остаётся только «что пользователь сейчас печатает»: текст ДЗ, причину опоздания, поиск.

const PAGE_SIZE = 8;
const MAX_TEXT = 3_900;
const HOMEWORK_LIMIT = 2_000;

const COMMANDS = [
  { name: 'start', description: 'Меню · Menu' },
  { name: 'today', description: 'Пары на сегодня · Today' },
  { name: 'tomorrow', description: 'Пары на завтра · Tomorrow' },
  { name: 'week', description: 'Неделя · Week' },
  { name: 'homework', description: 'Домашка · Homework' },
  { name: 'add', description: 'Записать ДЗ · Add homework' },
  { name: 'find', description: 'Найти расписание · Search' },
  { name: 'absence', description: 'Предупредить старосту · Tell the representative' },
  { name: 'settings', description: 'Настройки и язык · Settings' },
  { name: 'setup', description: 'Привязать чат к группе · Link chat' },
  { name: 'help', description: 'Все команды · Help' },
];

const ALIASES = {
  menu: 'start',
  schedule: 'today',
  profile: 'settings',
  language: 'language',
  lang: 'language',
  search: 'find',
  homework_create: 'add',
  homework_personal: 'add',
  homework_team: 'team',
  homework_access: 'access',
};

const buttonText = (value) => String(value).slice(0, 64);
const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}\n…` : text);
const button = (text, payload, intent) => Keyboard.button.callback(buttonText(text), payload, intent ? { intent } : undefined);
const userId = (ctx) => ctx.user?.user_id ?? ctx.message?.sender?.user_id;
const isGroupChat = (ctx) => ctx.message?.recipient?.chat_type === 'chat' || ctx.chat?.type === 'chat';
const displayName = (user) => user?.name
  || [user?.first_name, user?.last_name].filter(Boolean).join(' ')
  || (user?.username ? `@${user.username}` : `MAX ID ${user?.user_id}`);
const subgroupFromCode = (code) => (code === '1' ? 1 : code === '2' ? 2 : null);
const lessonKey = (lesson) => `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;

export const createBot = ({
  token, service, miniAppUrl, miniAppButton = 'app', preferences, community,
}) => {
  const bot = new Bot(token);
  const sessions = new Map();

  const sessionKey = (ctx) => `${ctx.chatId}:${userId(ctx)}`;
  const session = (ctx) => sessions.get(sessionKey(ctx)) ?? {};
  const setSession = (ctx, value) => {
    if (value) sessions.set(sessionKey(ctx), value);
    else sessions.delete(sessionKey(ctx));
  };

  const savePrefs = async (ctx, patch) => {
    const value = { ...await preferences.get(userId(ctx)), ...patch };
    await preferences.set(userId(ctx), value);
    ctx.prefs = value;
    return value;
  };

  // Ответ на нажатие кнопки меняет то же сообщение, чтобы чат не превращался в ленту меню.
  const show = async (ctx, text, rows = []) => {
    const attachments = rows.length ? [Keyboard.inlineKeyboard(rows)] : [];
    if (ctx.update.update_type === 'message_callback') {
      return ctx.answerOnCallback({ message: { text: clip(text), format: 'markdown', attachments } });
    }
    return ctx.reply(clip(text), { format: 'markdown', attachments });
  };
  const toast = (ctx, text) => (ctx.update.update_type === 'message_callback'
    ? ctx.answerOnCallback({ notification: text })
    : ctx.reply(text));

  const appButton = (t) => {
    if (miniAppButton === 'link') return miniAppUrl ? Keyboard.button.link(t.openApp, miniAppUrl) : null;
    if (!bot.botInfo?.username) return null;
    return { type: 'open_app', text: t.openApp, web_app: bot.botInfo.username, contact_id: bot.botInfo.user_id };
  };

  const isChatManager = async (ctx) => {
    try {
      const response = await ctx.getChatAdmins();
      return response.members?.some((member) => member.user_id === userId(ctx) && (member.is_owner || member.is_admin));
    } catch {
      return false;
    }
  };

  const ownGroup = (prefs) => (prefs.selection?.kind === 'group' ? prefs.selection : null);

  // Меню и приветствие

  const languagePrompt = (ctx) => show(ctx, texts(DEFAULT_LANGUAGE).languagePrompt, [[
    button('Русский', 'lang:ru'), button('English', 'lang:en'),
  ]]);

  const privateMenu = async (ctx) => {
    const { t, prefs } = ctx;
    const group = ownGroup(prefs);
    const app = appButton(t);
    if (!group) {
      setSession(ctx, { step: 'own-group' });
      const rows = [[button(t.chooseByInstitute, 'inst:0')]];
      if (app) rows.push([app]);
      return show(ctx, `${t.welcomeTitle}\n\n${t.welcomeNoGroup}`, rows);
    }
    setSession(ctx, null);
    const rows = [
      [button(t.today, `s:group:${group.id}:d0`, 'positive'), button(t.tomorrow, `s:group:${group.id}:d1`), button(t.week, `s:group:${group.id}:w0`)],
      [button(t.homework, 'hw:list'), button(t.addPersonal, 'ph:pick')],
      [button(t.search, 'find'), button(t.settings, 'settings')],
    ];
    if (app) rows.push([app]);
    return show(ctx, `${t.menuTitle({ group: group.title, subgroup: prefs.subgroup })}\n\n${t.menuHint}`, rows);
  };

  const groupMenuRows = (t) => [
    [button(t.today, 'g:d0', 'positive'), button(t.tomorrow, 'g:d1'), button(t.week, 'g:w0')],
    [button(t.homework, 'hw:list'), button(t.addHomework, 'gh:pick')],
  ];

  const start = async (ctx) => {
    if (isGroupChat(ctx)) return groupHelp(ctx);
    if (!normalizeLanguage(ctx.prefs.lang)) return languagePrompt(ctx);
    return privateMenu(ctx);
  };

  const help = (ctx) => {
    if (isGroupChat(ctx)) return groupHelp(ctx);
    return show(ctx, ctx.t.help, [[button(ctx.t.menu, 'menu')]]);
  };
  const groupHelp = async (ctx) => {
    const config = await community.getChat(ctx.chatId);
    const rows = config?.group ? groupMenuRows(ctx.t) : [[button(ctx.t.setup, 'setup', 'positive')]];
    return show(ctx, ctx.t.helpGroup, rows);
  };

  // Расписание

  const entityTitle = async (kind, id) => {
    const lists = { group: () => service.groups(), teacher: () => service.teachers(), auditory: () => service.auditories() };
    const items = await lists[kind]().catch(() => []);
    const item = items.find((candidate) => candidate.id === Number(id));
    return item?.title ?? item?.fullName ?? item?.name ?? '';
  };

  const scheduleRows = (t, prefix, mode, offset, extra = []) => {
    const rows = [[
      button(t.today, `${prefix}:d0`, mode === 'd' && offset === 0 ? 'positive' : undefined),
      button(t.tomorrow, `${prefix}:d1`, mode === 'd' && offset === 1 ? 'positive' : undefined),
      button(t.week, `${prefix}:w0`, mode === 'w' && offset === 0 ? 'positive' : undefined),
    ]];
    if (mode === 'w') {
      rows.push([
        button(t.previousWeek, `${prefix}:w${offset - 1}`),
        ...(offset !== 0 ? [button(t.currentWeek, `${prefix}:w0`)] : []),
        button(t.nextWeek, `${prefix}:w${offset + 1}`),
      ]);
    }
    return [...rows, ...extra];
  };

  const renderSchedule = async (ctx, { kind, id, subgroup, title, mode, offset, prefix, extraRows }) => {
    const { t, lang } = ctx;
    const date = mode === 'w' ? addDays(new Date(), offset * 7) : addDays(new Date(), offset);
    let schedule;
    try {
      schedule = await service[`${kind}Schedule`](id, { week: date, subgroup });
    } catch (error) {
      console.error('Schedule request failed:', error.message);
      return show(ctx, t.scheduleUnavailable, [[button(t.menu, 'menu')]]);
    }
    const text = mode === 'w'
      ? formatScheduleWeek(lang, schedule, { title })
      : formatScheduleDay(lang, schedule, date, { title });
    return show(ctx, text, scheduleRows(t, prefix, mode, offset, extraRows));
  };

  const showSchedule = async (ctx, kind, id, mode, offset) => {
    const { t, prefs } = ctx;
    const own = ownGroup(prefs);
    const isOwn = kind === 'group' && own?.id === Number(id);
    const name = isOwn ? own.title : await entityTitle(kind, id);
    const suffix = isOwn ? ` · ${t.menuTitle({ group: '', subgroup: prefs.subgroup }).split(' · ')[1]}` : '';
    const extraRows = [];
    if (kind === 'group' && !isOwn) extraRows.push([button(t.makeMine, `mine:${id}`)]);
    extraRows.push([button(t.menu, 'menu')]);
    return renderSchedule(ctx, {
      kind, id: Number(id), subgroup: isOwn ? prefs.subgroup ?? null : null,
      title: `**${name}**${suffix}`, mode, offset, prefix: `s:${kind}:${id}`, extraRows,
    });
  };

  const showOwnSchedule = async (ctx, mode, offset) => {
    const group = ownGroup(ctx.prefs);
    if (!group) {
      setSession(ctx, { step: 'own-group' });
      return show(ctx, ctx.t.noGroupYet, [[button(ctx.t.chooseByInstitute, 'inst:0')]]);
    }
    return showSchedule(ctx, 'group', group.id, mode, offset);
  };

  const showChatSchedule = async (ctx, mode, offset) => {
    const config = await community.getChat(ctx.chatId);
    if (!config?.group) return show(ctx, ctx.t.groupNotConfigured, [[button(ctx.t.setup, 'setup', 'positive')]]);
    const subgroup = config.subgroup ?? null;
    return renderSchedule(ctx, {
      kind: 'group', id: config.group.id, subgroup,
      title: ctx.t.menuTitle({ group: config.group.title, subgroup }),
      mode, offset, prefix: 'g',
      extraRows: [[button(ctx.t.homework, 'hw:list'), button(ctx.t.addHomework, 'gh:pick')]],
    });
  };

  const scheduleCommand = (mode, offset) => (ctx) => (isGroupChat(ctx)
    ? showChatSchedule(ctx, mode, offset)
    : showOwnSchedule(ctx, mode, offset));

  // Поиск и выбор группы

  const search = async (query, { groupsOnly = false } = {}) => {
    const [groups, teachers, auditories] = await Promise.all([
      service.searchGroups(query, { limit: 20 }),
      groupsOnly ? [] : service.searchTeachers(query, { limit: 20 }),
      groupsOnly ? [] : service.searchAuditories(query, { limit: 20 }),
    ]);
    return [
      ...groups.map((item) => ({ kind: 'group', id: item.id, title: item.title, hint: item.institute })),
      ...teachers.map((item) => ({ kind: 'teacher', id: item.id, title: item.fullName || item.name })),
      ...auditories.map((item) => ({ kind: 'auditory', id: item.id, title: item.title })),
    ];
  };

  const kindLabel = (t, kind) => ({ group: t.kindGroup, teacher: t.kindTeacher, auditory: t.kindAuditory }[kind]);

  const handleSearch = async (ctx, query, { mode }) => {
    const { t } = ctx;
    let results;
    try {
      results = await search(query, { groupsOnly: mode !== 'any' });
    } catch (error) {
      console.error('Search failed:', error.message);
      return show(ctx, t.scheduleUnavailable);
    }
    if (!results.length) return show(ctx, t.searchEmpty(query), mode === 'own' ? [[button(t.chooseByInstitute, 'inst:0')]] : []);
    // Единственное совпадение открываем сразу — без лишнего нажатия.
    if (results.length === 1) {
      const [item] = results;
      if (mode === 'own') return subgroupPrompt(ctx, item, 'sub');
      if (mode === 'link') return subgroupPrompt(ctx, item, 'lsub');
      return showSchedule(ctx, item.kind, item.id, 'd', 0);
    }
    const payload = (item) => {
      if (mode === 'own') return `mine:${item.id}`;
      if (mode === 'link') return `link:${item.id}`;
      return `s:${item.kind}:${item.id}:d0`;
    };
    const rows = results.slice(0, PAGE_SIZE).map((item) => [button(
      mode === 'any' ? `${item.title} · ${kindLabel(t, item.kind)}` : item.title,
      payload(item),
    )]);
    rows.push(mode === 'link' ? [button(t.cancel, 'cancel')] : [button(t.menu, 'menu')]);
    return show(ctx, t.searchResults(query), rows);
  };

  const subgroupPrompt = (ctx, group, prefix) => show(ctx, ctx.t.subgroupPrompt(group.title), [[
    button(ctx.t.subgroupNumber(1), `${prefix}:${group.id}:1`),
    button(ctx.t.subgroupNumber(2), `${prefix}:${group.id}:2`),
  ], [button(ctx.t.subgroupAll, `${prefix}:${group.id}:all`)]]);

  const findGroup = async (id) => (await service.groups()).find((group) => group.id === Number(id));

  const pagedRows = (t, items, page, toButton, pagePrefix, backPayload) => {
    const total = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const safe = Math.min(Math.max(page, 0), total - 1);
    const rows = items.slice(safe * PAGE_SIZE, (safe + 1) * PAGE_SIZE).map((item, index) => [toButton(item, safe * PAGE_SIZE + index)]);
    if (total > 1) {
      rows.push([
        ...(safe > 0 ? [button('‹', `${pagePrefix}${safe - 1}`)] : []),
        button(t.page(safe + 1, total), 'noop'),
        ...(safe + 1 < total ? [button('›', `${pagePrefix}${safe + 1}`)] : []),
      ]);
    }
    rows.push([button(t.back, backPayload)]);
    return rows;
  };

  // Домашнее задание

  const upcomingLessons = async (groupId, subgroup) => {
    const [thisWeek, nextWeek] = await Promise.all([
      service.groupSchedule(groupId, { week: new Date(), subgroup }),
      service.groupSchedule(groupId, { week: addDays(new Date(), 7), subgroup }),
    ]);
    const today = toDateKey(new Date());
    const seen = new Set();
    return [...thisWeek.lessons, ...nextWeek.lessons]
      .filter((lesson) => lesson.date >= today)
      .filter((lesson) => !seen.has(lessonKey(lesson)) && seen.add(lessonKey(lesson)))
      .slice(0, 14);
  };

  const findLesson = async (groupId, subgroup, key) =>
    (await upcomingLessons(groupId, subgroup)).find((lesson) => lessonKey(lesson) === key);

  const lessonWhen = (lang, lesson) => `${formatDate(lang, lesson.date)} · ${lesson.time}`;

  const lessonPicker = async (ctx, groupId, subgroup, prefix, prompt) => {
    const { t, lang } = ctx;
    let lessons;
    try {
      lessons = await upcomingLessons(groupId, subgroup);
    } catch {
      return show(ctx, t.scheduleUnavailable);
    }
    if (!lessons.length) return show(ctx, t.noUpcomingLessons, [[button(t.menu, isGroupChat(ctx) ? 'help' : 'menu')]]);
    const rows = lessons.map((lesson) => [button(
      `${formatDate(lang, lesson.date, { weekday: 'short', day: 'numeric' })} · ${lesson.time.slice(0, 5)} · ${lesson.subject}`,
      `${prefix}:${lessonKey(lesson)}`,
    )]);
    rows.push([button(t.cancel, 'cancel')]);
    return show(ctx, prompt, rows);
  };

  const canEditHomework = (ctx, config) => {
    if (!config) return false;
    if (config.homeworkMode === 'all') return true;
    const actor = userId(ctx);
    return actor === config.headman?.userId || (config.editors ?? []).some((editor) => editor.userId === actor);
  };

  const showHomework = async (ctx) => {
    const { t, lang, prefs } = ctx;
    if (isGroupChat(ctx)) {
      const config = await community.getChat(ctx.chatId);
      if (!config?.group) return show(ctx, t.groupNotConfigured, [[button(t.setup, 'setup', 'positive')]]);
      const items = await community.homeworkForGroup(config.group.id, { subgroup: config.subgroup ?? null });
      return show(ctx, formatHomework(lang, items), [[button(t.addHomework, 'gh:pick'), button(t.team, 'team')]]);
    }
    const group = ownGroup(prefs);
    if (!group) return show(ctx, t.noGroupYet);
    const items = await community.homeworkForUser(group.id, userId(ctx), { subgroup: prefs.subgroup });
    return show(ctx, formatHomework(lang, items), [[button(t.addPersonal, 'ph:pick')], [button(t.menu, 'menu')]]);
  };

  const beginAdd = async (ctx) => {
    const { t, prefs } = ctx;
    if (!isGroupChat(ctx)) {
      const group = ownGroup(prefs);
      if (!group) return show(ctx, t.noGroupYet);
      return lessonPicker(ctx, group.id, prefs.subgroup ?? null, 'ph', t.personalLessonPrompt);
    }
    const config = await community.getChat(ctx.chatId);
    if (!config?.group) return show(ctx, t.groupNotConfigured, [[button(t.setup, 'setup', 'positive')]]);
    if (!canEditHomework(ctx, config)) return show(ctx, t.homeworkForbidden);
    return lessonPicker(ctx, config.group.id, config.subgroup ?? null, 'gh', t.homeworkLessonPrompt);
  };

  // Группа: настройка и роли

  const beginSetup = async (ctx, query = '') => {
    if (!isGroupChat(ctx)) return show(ctx, ctx.t.helpGroup);
    if (!await isChatManager(ctx)) return show(ctx, ctx.t.needChatAdmin);
    if (query) return handleSearch(ctx, query, { mode: 'link' });
    setSession(ctx, { step: 'setup' });
    return show(ctx, ctx.t.setupSearchPrompt, [[button(ctx.t.cancel, 'cancel')]]);
  };

  const replyTarget = (ctx) => (ctx.message?.link?.type === 'reply' ? ctx.message.link.sender : null);

  const assignHeadman = async (ctx) => {
    const { t } = ctx;
    if (!isGroupChat(ctx)) return show(ctx, t.helpGroup);
    if (!await isChatManager(ctx)) return show(ctx, t.needChatAdmin);
    const config = await community.getChat(ctx.chatId);
    if (!config?.group) return show(ctx, t.groupNotConfigured, [[button(t.setup, 'setup', 'positive')]]);
    const target = replyTarget(ctx);
    if (!target || target.is_bot) return show(ctx, t.headmanHint);
    await community.setChat(ctx.chatId, {
      headman: { userId: target.user_id, name: displayName(target), username: target.username ?? null },
    });
    return show(ctx, t.headmanSet(displayName(target)));
  };

  const toggleEditor = async (ctx) => {
    const { t } = ctx;
    if (!isGroupChat(ctx)) return show(ctx, t.helpGroup);
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return show(ctx, t.editorOnlyHeadman);
    const target = replyTarget(ctx);
    if (!target || target.is_bot) return show(ctx, t.editorHint);
    const current = config.editors ?? [];
    const exists = current.some((editor) => editor.userId === target.user_id);
    const editors = exists
      ? current.filter((editor) => editor.userId !== target.user_id)
      : [...current, { userId: target.user_id, name: displayName(target), username: target.username ?? null }];
    await community.setChat(ctx.chatId, { editors });
    return show(ctx, exists ? t.editorRemoved(displayName(target)) : t.editorAdded(displayName(target)));
  };

  const showTeam = async (ctx) => {
    const { t } = ctx;
    if (!isGroupChat(ctx)) return show(ctx, t.helpGroup);
    const config = await community.getChat(ctx.chatId);
    if (!config?.group) return show(ctx, t.groupNotConfigured, [[button(t.setup, 'setup', 'positive')]]);
    return show(ctx, [
      t.teamTitle, '',
      t.teamHeadman(config.headman?.name),
      t.teamEditors((config.editors ?? []).map((editor) => editor.name)),
      t.teamAccess(config.homeworkMode === 'all'),
    ].join('\n'));
  };

  const accessPrompt = async (ctx) => {
    const { t } = ctx;
    if (!isGroupChat(ctx)) return show(ctx, t.helpGroup);
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return show(ctx, t.accessOnlyHeadman);
    return show(ctx, t.accessPrompt, [[button(t.accessEditors, 'acc:editors'), button(t.accessAll, 'acc:all')]]);
  };

  // Настройки

  const showSettings = async (ctx) => {
    const { t, prefs } = ctx;
    if (isGroupChat(ctx)) return groupHelp(ctx);
    const group = ownGroup(prefs);
    const reminders = prefs.remindersEnabled !== false;
    const rows = [[button(t.changeGroup, 'set:group')]];
    if (group) rows.push([button(t.changeSubgroup, `set:sub:${group.id}`)]);
    rows.push([button(reminders ? t.remindersOff : t.remindersOn, 'set:rem')]);
    rows.push([button(t.changeLanguage, 'set:lang')]);
    rows.push([button(t.menu, 'menu')]);
    const lines = [
      t.settingsGroup(group?.title),
      group ? t.settingsSubgroup(prefs.subgroup) : '',
      t.settingsReminders(reminders),
      t.settingsLanguage,
    ].filter(Boolean);
    return show(ctx, `${t.settingsTitle}\n\n${lines.join('\n')}`, rows);
  };

  const switchLanguage = async (ctx, next) => {
    if (isGroupChat(ctx)) {
      if (!await isChatManager(ctx)) return show(ctx, ctx.t.needChatAdmin);
      const config = await community.getChat(ctx.chatId);
      const lang = next ?? ((config?.lang ?? ctx.lang) === 'ru' ? 'en' : 'ru');
      await community.setChat(ctx.chatId, { lang });
      ctx.lang = lang;
      ctx.t = texts(lang);
      return groupHelp(ctx);
    }
    const lang = next ?? (ctx.lang === 'ru' ? 'en' : 'ru');
    await savePrefs(ctx, { lang });
    ctx.lang = lang;
    ctx.t = texts(lang);
    return null;
  };

  // Сообщение старосте

  const beginAbsence = async (ctx) => {
    const { t, prefs } = ctx;
    if (isGroupChat(ctx)) return show(ctx, t.absenceInGroup);
    const group = ownGroup(prefs);
    if (!group) return show(ctx, t.noGroupYet);
    const chats = (await community.chatsForGroup(group.id)).filter((chat) => chat.headman?.userId);
    if (!chats.length) return show(ctx, t.absenceNoHeadman, [[button(t.menu, 'menu')]]);
    return show(ctx, t.absencePrompt, [
      [button(t.absenceLate, 'abs:late'), button(t.absenceMissing, 'abs:absent')],
      [button(t.cancel, 'cancel')],
    ]);
  };

  const sendAbsence = async (ctx, state, text) => {
    const { t, prefs } = ctx;
    const images = (ctx.message?.body?.attachments ?? []).filter((attachment) => attachment.type === 'image');
    if (!text) return ctx.reply(t.absenceNeedsText);
    const group = ownGroup(prefs);
    const chat = group && (await community.chatsForGroup(group.id)).find((item) => item.headman?.userId);
    setSession(ctx, null);
    if (!chat) return ctx.reply(t.absenceNoHeadman);
    const headmanLang = (await preferences.get(chat.headman.userId)).lang;
    const message = texts(headmanLang).absenceToHeadman(state.kind, chat.group.title, text);
    const attachments = images.map((image) => ({ type: 'image', payload: { token: image.payload.token } }));
    const notice = { chatId: chat.chatId, groupId: chat.group.id, senderId: userId(ctx), type: state.kind, text, imageCount: images.length };
    try {
      await bot.api.sendMessageToUser(chat.headman.userId, message, { format: 'markdown', attachments });
      await community.addNotice(notice);
      return ctx.reply(t.absenceSent);
    } catch {
      await community.addNotice({ ...notice, status: 'pending' });
      return ctx.reply(t.absencePending);
    }
  };

  // Команды

  const commandHandlers = {
    start,
    help,
    today: scheduleCommand('d', 0),
    tomorrow: scheduleCommand('d', 1),
    week: scheduleCommand('w', 0),
    homework: showHomework,
    add: beginAdd,
    find: (ctx, args) => {
      if (isGroupChat(ctx)) return groupHelp(ctx);
      if (args) return handleSearch(ctx, args, { mode: ownGroup(ctx.prefs) ? 'any' : 'own' });
      setSession(ctx, { step: ownGroup(ctx.prefs) ? 'search' : 'own-group' });
      return show(ctx, ctx.t.searchPrompt);
    },
    settings: showSettings,
    language: async (ctx, args) => {
      const next = normalizeLanguage(args.toLowerCase());
      await switchLanguage(ctx, next);
      if (!isGroupChat(ctx)) return privateMenu(ctx);
      return null;
    },
    absence: beginAbsence,
    setup: beginSetup,
    headman: assignHeadman,
    editor: toggleEditor,
    team: showTeam,
    access: accessPrompt,
  };

  bot.syncCommands = () => bot.api.setMyCommands(COMMANDS);

  // Язык и профиль нужны почти каждому обработчику — читаем один раз на апдейт.
  bot.use(async (ctx, next) => {
    const id = userId(ctx);
    ctx.prefs = id ? await preferences.get(id) : {};
    let lang = normalizeLanguage(ctx.prefs.lang);
    if (ctx.chatId && isGroupChat(ctx)) lang = normalizeLanguage((await community.getChat(ctx.chatId))?.lang) ?? lang;
    ctx.lang = lang ?? DEFAULT_LANGUAGE;
    ctx.t = texts(ctx.lang);
    return next();
  });

  bot.on('bot_started', start);
  bot.on('bot_added', async (ctx) => {
    if (ctx.update.is_channel) return;
    await ctx.reply(ctx.t.groupWelcome, { format: 'markdown', attachments: [Keyboard.inlineKeyboard([[button(ctx.t.setup, 'setup', 'positive')]])] });
  });
  bot.on('bot_removed', (ctx) => community.removeChat(ctx.chatId));

  // Кнопки

  bot.action('noop', (ctx) => ctx.answerOnCallback({ notification: ctx.t.pickFromList }));
  bot.action('menu', (ctx) => (isGroupChat(ctx) ? groupHelp(ctx) : privateMenu(ctx)));
  bot.action('help', help);
  bot.action(/^lang:(ru|en)$/, async (ctx) => {
    await switchLanguage(ctx, ctx.match[1]);
    return privateMenu(ctx);
  });
  bot.action('find', (ctx) => {
    setSession(ctx, { step: 'search' });
    return show(ctx, ctx.t.searchPrompt, [[button(ctx.t.menu, 'menu')]]);
  });
  bot.action(/^s:(group|teacher|auditory):(\d+):([dw])(-?\d+)$/, (ctx) =>
    showSchedule(ctx, ctx.match[1], Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])));
  bot.action(/^g:([dw])(-?\d+)$/, (ctx) => showChatSchedule(ctx, ctx.match[1], Number(ctx.match[2])));

  bot.action(/^mine:(\d+)$/, async (ctx) => {
    const group = await findGroup(ctx.match[1]);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    return subgroupPrompt(ctx, group, 'sub');
  });
  bot.action(/^sub:(\d+):(all|1|2)$/, async (ctx) => {
    const group = await findGroup(ctx.match[1]);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    await savePrefs(ctx, {
      selection: { kind: 'group', id: group.id, title: group.title },
      institute: group.institute, course: group.course, subgroup: subgroupFromCode(ctx.match[2]),
    });
    setSession(ctx, null);
    return showSchedule(ctx, 'group', group.id, 'd', 0);
  });

  bot.action(/^inst:(\d+)$/, async (ctx) => {
    const institutes = await service.institutes();
    return show(ctx, ctx.t.pickInstitute, pagedRows(ctx.t, institutes, Number(ctx.match[1]),
      (name, index) => button(name, `crs:${index}`), 'inst:', 'menu'));
  });
  bot.action(/^crs:(\d+)$/, async (ctx) => {
    const institute = (await service.institutes())[Number(ctx.match[1])];
    if (!institute) return toast(ctx, ctx.t.selectionExpired);
    const groups = await service.searchGroups('', { institute, limit: 5_000 });
    const courses = [...new Set(groups.map((group) => group.course).filter(Boolean))].sort((a, b) => a - b);
    return show(ctx, `**${institute}**\n\n${ctx.t.pickCourse}`, pagedRows(ctx.t, courses, 0,
      (course) => button(ctx.t.courseLabel(course), `grp:${ctx.match[1]}:${course}:0`), `crs:${ctx.match[1]}:`, 'inst:0'));
  });
  bot.action(/^grp:(\d+):(\d+):(\d+)$/, async (ctx) => {
    const [, instituteIndex, course, page] = ctx.match;
    const institute = (await service.institutes())[Number(instituteIndex)];
    if (!institute) return toast(ctx, ctx.t.selectionExpired);
    const groups = await service.searchGroups('', { institute, course: Number(course), limit: 5_000 });
    return show(ctx, `**${institute}** · ${ctx.t.courseLabel(course)}\n\n${ctx.t.pickGroup}`,
      pagedRows(ctx.t, groups, Number(page), (group) => button(group.title, `mine:${group.id}`),
        `grp:${instituteIndex}:${course}:`, `crs:${instituteIndex}`));
  });

  bot.action('settings', showSettings);
  bot.action('set:group', (ctx) => {
    setSession(ctx, { step: 'own-group' });
    return show(ctx, ctx.t.changeGroupPrompt, [[button(ctx.t.chooseByInstitute, 'inst:0')], [button(ctx.t.back, 'settings')]]);
  });
  bot.action(/^set:sub:(\d+)$/, async (ctx) => {
    const group = await findGroup(ctx.match[1]);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    return subgroupPrompt(ctx, group, 'sub');
  });
  bot.action('set:rem', async (ctx) => {
    await savePrefs(ctx, { remindersEnabled: ctx.prefs.remindersEnabled === false });
    return showSettings(ctx);
  });
  bot.action('set:lang', async (ctx) => {
    await switchLanguage(ctx);
    return showSettings(ctx);
  });

  bot.action('hw:list', showHomework);
  bot.action('ph:pick', beginAdd);
  bot.action('gh:pick', beginAdd);
  bot.action(/^ph:(\d{4}-\d{2}-\d{2}:\d+:\d+)$/, async (ctx) => {
    const { t, lang, prefs } = ctx;
    const group = ownGroup(prefs);
    if (!group || isGroupChat(ctx)) return toast(ctx, t.selectionExpired);
    const lesson = await findLesson(group.id, prefs.subgroup ?? null, ctx.match[1]);
    if (!lesson) return toast(ctx, t.selectionExpired);
    const current = (await community.homeworkForUser(group.id, userId(ctx), {
      from: lesson.date, to: lesson.date, subgroup: prefs.subgroup,
    })).find((item) => lessonKey({ date: item.lessonDate, lessonNumber: item.lessonNumber, subgroup: item.subgroup }) === lessonKey(lesson));
    setSession(ctx, { step: 'personal-text', lesson });
    const rows = [];
    if (current?.personalText) rows.push([button(t.personalReset, `phr:${lessonKey(lesson)}`, 'negative')]);
    rows.push([button(t.cancel, 'cancel')]);
    return show(ctx, t.personalTextPrompt(lesson.subject, lessonWhen(lang, lesson), current?.sharedText), rows);
  });
  bot.action(/^phr:(\d{4}-\d{2}-\d{2}):(\d+):(\d+)$/, async (ctx) => {
    const group = ownGroup(ctx.prefs);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    await community.removePersonalHomework(userId(ctx), {
      groupId: group.id, lessonDate: ctx.match[1], lessonNumber: Number(ctx.match[2]), subgroup: Number(ctx.match[3]) || null,
    });
    setSession(ctx, null);
    return show(ctx, ctx.t.personalResetDone, [[button(ctx.t.homework, 'hw:list'), button(ctx.t.menu, 'menu')]]);
  });
  bot.action(/^gh:(\d{4}-\d{2}-\d{2}:\d+:\d+)$/, async (ctx) => {
    const { t, lang } = ctx;
    const config = await community.getChat(ctx.chatId);
    if (!config?.group || !canEditHomework(ctx, config)) return toast(ctx, t.homeworkForbidden);
    const lesson = await findLesson(config.group.id, config.subgroup ?? null, ctx.match[1]);
    if (!lesson) return toast(ctx, t.selectionExpired);
    setSession(ctx, { step: 'group-text', lesson });
    return show(ctx, t.homeworkTextPrompt(lesson.subject, lessonWhen(lang, lesson)), [[button(t.cancel, 'cancel')]]);
  });
  bot.action('cancel', (ctx) => {
    setSession(ctx, null);
    return show(ctx, ctx.t.homeworkCancelled, [[button(ctx.t.menu, isGroupChat(ctx) ? 'help' : 'menu')]]);
  });

  bot.action(/^abs:(late|absent)$/, (ctx) => {
    setSession(ctx, { step: 'absence-text', kind: ctx.match[1] });
    return show(ctx, ctx.match[1] === 'late' ? ctx.t.absenceDetailsLate : ctx.t.absenceDetailsMissing, [[button(ctx.t.cancel, 'cancel')]]);
  });

  bot.action('setup', (ctx) => beginSetup(ctx));
  bot.action(/^link:(\d+)$/, async (ctx) => {
    if (!await isChatManager(ctx)) return toast(ctx, ctx.t.needChatAdmin);
    const group = await findGroup(ctx.match[1]);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    return subgroupPrompt(ctx, group, 'lsub');
  });
  bot.action(/^lsub:(\d+):(all|1|2)$/, async (ctx) => {
    if (!await isChatManager(ctx)) return toast(ctx, ctx.t.needChatAdmin);
    const group = await findGroup(ctx.match[1]);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    const chat = await ctx.getChat().catch(() => null);
    const current = await community.getChat(ctx.chatId);
    await community.setChat(ctx.chatId, {
      title: chat?.title ?? current?.title ?? null,
      lang: current?.lang ?? ctx.lang,
      institute: group.institute,
      course: group.course,
      group: { kind: 'group', id: group.id, title: group.title },
      subgroup: subgroupFromCode(ctx.match[2]),
      homeworkMode: current?.homeworkMode ?? 'editors',
      configuredBy: userId(ctx),
      configuredAt: new Date().toISOString(),
    });
    setSession(ctx, null);
    return show(ctx, ctx.t.chatLinked(group.title), groupMenuRows(ctx.t));
  });
  bot.action('team', showTeam);
  bot.action(/^acc:(editors|all)$/, async (ctx) => {
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return toast(ctx, ctx.t.accessOnlyHeadman);
    await community.setChat(ctx.chatId, { homeworkMode: ctx.match[1] });
    return show(ctx, ctx.t.accessSaved(ctx.match[1] === 'all'));
  });

  // Сообщения: команды, ввод по шагам, поиск

  const saveGroupHomework = async (ctx, state, text) => {
    const { t } = ctx;
    const config = await community.getChat(ctx.chatId);
    setSession(ctx, null);
    if (!config?.group || !canEditHomework(ctx, config)) return ctx.reply(t.homeworkRightsChanged);
    const { lesson } = state;
    await community.upsertHomework({
      chatId: ctx.chatId,
      groupId: config.group.id,
      groupTitle: config.group.title,
      lessonDate: lesson.date,
      lessonNumber: lesson.lessonNumber,
      lessonTime: lesson.time,
      subgroup: lesson.subgroup ?? null,
      subject: lesson.subject,
      text,
      authorId: userId(ctx),
      authorName: displayName(ctx.message.sender),
    });
    return show(ctx, t.homeworkSaved(lesson.subject), [[button(t.homework, 'hw:list')]]);
  };

  const savePersonalHomework = async (ctx, state, text) => {
    const { t, prefs } = ctx;
    const group = ownGroup(prefs);
    setSession(ctx, null);
    if (!group) return ctx.reply(t.noGroupYet);
    const { lesson } = state;
    await community.setPersonalHomework(userId(ctx), {
      groupId: group.id,
      groupTitle: group.title,
      lessonDate: lesson.date,
      lessonNumber: lesson.lessonNumber,
      lessonTime: lesson.time,
      subgroup: lesson.subgroup ?? null,
      subject: lesson.subject,
      text,
    });
    return show(ctx, t.personalSaved(lesson.subject), [[button(t.homework, 'hw:list'), button(t.menu, 'menu')]]);
  };

  bot.on('message_created', async (ctx) => {
    const text = ctx.message?.body?.text?.trim() ?? '';
    const command = parseCommand(ctx.message, { botId: bot.botInfo?.user_id, botUsername: bot.botInfo?.username });
    if (command) {
      const name = ALIASES[command.name] ?? command.name;
      const handler = commandHandlers[name];
      if (handler) return handler(ctx, command.args);
      const addressed = /^\/[a-z0-9_]+@/i.test(text) || /^@/.test(text);
      if (isGroupChat(ctx) && !addressed) return undefined;
      return show(ctx, `${ctx.t.unknownCommand}\n\n${isGroupChat(ctx) ? ctx.t.helpGroup : ctx.t.help}`);
    }
    if (text.startsWith('/')) return undefined;

    const state = session(ctx);
    if (['group-text', 'personal-text'].includes(state.step)) {
      if (!text) return ctx.reply(ctx.t.homeworkNeedsText);
      if (text.length > HOMEWORK_LIMIT) return ctx.reply(ctx.t.homeworkTooLong);
      return state.step === 'group-text' ? saveGroupHomework(ctx, state, text) : savePersonalHomework(ctx, state, text);
    }
    if (state.step === 'absence-text') return sendAbsence(ctx, state, text);
    if (state.step === 'setup') {
      if (!text) return undefined;
      return handleSearch(ctx, text, { mode: 'link' });
    }
    if (isGroupChat(ctx) || !text) return undefined;
    if (!normalizeLanguage(ctx.prefs.lang)) return languagePrompt(ctx);
    const own = state.step === 'own-group' || !ownGroup(ctx.prefs);
    return handleSearch(ctx, text, { mode: own ? 'own' : 'any' });
  });

  bot.catch(async (error, ctx) => {
    console.error('Bot update failed:', error);
    try {
      const t = ctx.t ?? texts(DEFAULT_LANGUAGE);
      if (ctx.update?.update_type === 'message_callback') await ctx.answerOnCallback({ notification: t.failed });
      else await ctx.reply(t.failed);
    } catch {}
  });
  return bot;
};
