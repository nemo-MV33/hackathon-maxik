import { randomUUID } from 'node:crypto';
import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { addDays, startOfWeek, toDateKey } from '../lib/date.js';
import {
  dateFromKey, irkutskClock, irkutskDateKey, irkutskMinutes, irkutskMoment, lessonEndMinutes,
} from '../lib/irkutsk.js';
import {
  NOTIFICATION_KINDS, REMINDER_MINUTES, isMuted, notificationEnabled, reminderMinutes, summaryTime,
} from '../lib/settings.js';
import { parseCommand } from './commands.js';
import { formatDate, formatHomework, formatScheduleDay, formatScheduleWeek } from './format.js';
import { DEFAULT_LANGUAGE, lessonTypeLabel, normalizeLanguage, texts } from './i18n.js';

// Кнопки несут всё нужное в payload, поэтому переживают перезапуск бота.
// В памяти остаётся только «что пользователь сейчас печатает»: текст ДЗ, причину опоздания, поиск.

const PAGE_SIZE = 8;
const MAX_TEXT = 3_900;
const HOMEWORK_LIMIT = 2_000;

// Описания короткие и по-русски: в списке «/» MAX показывает их рядом с именем бота, длинные обрезаются.
const COMMANDS = [
  { name: 'start', description: 'Меню' },
  { name: 'today', description: 'Пары сегодня' },
  { name: 'tomorrow', description: 'Пары завтра' },
  { name: 'week', description: 'Неделя' },
  { name: 'homework', description: 'Домашка' },
  { name: 'add', description: 'Записать ДЗ' },
  { name: 'news', description: 'Объявления' },
  { name: 'absence', description: 'Опоздаю / не приду' },
  { name: 'find', description: 'Найти расписание' },
  { name: 'settings', description: 'Настройки' },
  { name: 'manage', description: 'Управление чатом' },
  { name: 'help', description: 'Все команды' },
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
  announcements: 'news',
  account: 'settings',
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
const senderLabel = (user) => {
  const name = displayName(user);
  return user?.username && !name.startsWith('@') ? `${name} (@${user.username})` : name;
};

export { NOTIFICATION_KINDS, notificationEnabled };
export const CONTROL_TYPES = ['экзамен', 'зачёт'];
const EXAM_LIST_TYPES = [...CONTROL_TYPES, 'консультация'];
const SEMESTER_WEEKS = 20;
export const LATE_MINUTES = [5, 10, 15, 20, 30, 45];
const SUMMARY_TIMES = ['18:00', '19:00', '20:00', '21:00', '22:00'];
export const ABSENCE_REASONS = {
  late: ['late10', 'late20', 'transport'],
  absent: ['ill', 'family', 'certificate'],
};
const lessonKey = (lesson) => `${lesson.date}:${lesson.lessonNumber}:${lesson.subgroup ?? 0}`;

export const createBot = ({
  token, service, miniAppUrl, miniAppButton = 'app', preferences, community, onHomeworkSaved, onAnnouncement,
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
    const sender = ctx.user ?? ctx.message?.sender;
    const name = sender ? displayName(sender) : undefined;
    const value = { ...await preferences.get(userId(ctx)), ...(name ? { name } : {}), ...patch };
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

  // payload приходит в мини-приложение как start_param: так кнопка открывает нужный день или пару.
  const appButton = (t, payload, text = t.openApp) => {
    if (miniAppButton === 'link') {
      if (!miniAppUrl) return null;
      return Keyboard.button.link(text, payload ? `${miniAppUrl}?startapp=${payload}` : miniAppUrl);
    }
    if (!bot.botInfo?.username) return null;
    return {
      type: 'open_app', text, web_app: bot.botInfo.username, contact_id: bot.botInfo.user_id,
      ...(payload ? { payload } : {}),
    };
  };
  bot.appButton = appButton;

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

  const roleOf = async (ctx) => {
    const chats = await community.chatsWithRole(userId(ctx));
    const headman = chats.find((chat) => String(chat.headman?.userId) === String(userId(ctx)));
    return { chats, headman: headman ?? null, editor: chats.length > 0 };
  };

  // Главное меню — только самое частое: расписание, ДЗ и приложение. Остальное спрятано в «Ещё».
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
      [button(t.homework, 'hw:list'), button(t.more, 'more')],
    ];
    if (app) rows.push([app]);
    return show(ctx, `${t.menuTitle({ group: group.title, subgroup: prefs.subgroup })}\n\n${t.menuHint}`, rows);
  };

  const moreMenu = async (ctx) => {
    const { t } = ctx;
    if (isGroupChat(ctx)) return groupMore(ctx);
    const { headman, editor } = await roleOf(ctx);
    const rows = [
      [button(t.absenceButton, 'absence'), button(t.exams, 'exams')],
      [button(t.announcements, 'ann:list'), button(t.addPersonal, 'ph:pick')],
    ];
    if (headman) rows.push([button(t.lateToday, 'late:0'), button(t.newAnnouncement, 'ann:new')]);
    if (editor) rows.push([button(t.addGroupHomework, 'gp:pick')]);
    rows.push([button(t.search, 'find'), button(t.settings, 'settings')], [button(t.back, 'menu')]);
    return show(ctx, headman ? t.moreTitleHeadman : t.moreTitle, rows);
  };

  const groupMenuRows = (t) => [
    [button(t.today, 'g:d0', 'positive'), button(t.tomorrow, 'g:d1'), button(t.week, 'g:w0')],
    [button(t.homework, 'hw:list'), button(t.more, 'g:more')],
  ];

  const groupMore = (ctx) => show(ctx, ctx.t.groupMoreTitle, [
    [button(ctx.t.addHomework, 'gh:pick'), button(ctx.t.teamButton, 'team')],
    [button(ctx.t.manage, 'manage')],
    [button(ctx.t.back, 'help')],
  ]);

  const start = async (ctx) => {
    if (isGroupChat(ctx)) return groupHelp(ctx);
    const payload = ctx.update.update_type === 'bot_started' ? ctx.update.payload : undefined;
    if (payload) {
      const invited = await invitePrompt(ctx, payload);
      if (invited) return invited;
    }
    if (!normalizeLanguage(ctx.prefs.lang)) return languagePrompt(ctx);
    return privateMenu(ctx);
  };

  const help = (ctx) => {
    if (isGroupChat(ctx)) return groupHelp(ctx, { commands: ctx.update.update_type !== 'message_callback' });
    return show(ctx, ctx.t.help, [[button(ctx.t.menu, 'menu')]]);
  };
  const groupHelp = async (ctx, { commands = false } = {}) => {
    const { t } = ctx;
    const config = await community.getChat(ctx.chatId);
    if (!config?.group) return show(ctx, t.helpGroup, [[button(t.setup, 'setup', 'positive')], [button(t.manage, 'manage')]]);
    const title = `${t.groupMenuTitle(config.group.title)}\n\n${commands ? t.helpGroup : t.groupMenuHint}`;
    return show(ctx, title, groupMenuRows(t));
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

  // Кнопка открывает мини-приложение сразу на том дне, который сейчас на экране.
  const appDayKey = (mode, offset) => toDateKey(mode === 'w'
    ? startOfWeek(addDays(new Date(), offset * 7))
    : addDays(new Date(), offset));

  const showSchedule = async (ctx, kind, id, mode, offset) => {
    const { t, prefs } = ctx;
    const own = ownGroup(prefs);
    const isOwn = kind === 'group' && own?.id === Number(id);
    const name = isOwn ? own.title : await entityTitle(kind, id);
    const suffix = isOwn ? `, ${t.menuTitle({ group: '', subgroup: prefs.subgroup }).split(', ')[1]}` : '';
    const extraRows = [];
    if (kind === 'group' && !isOwn) extraRows.push([button(t.makeMine, `mine:${id}`)]);
    const app = isOwn ? appButton(t, `day_${appDayKey(mode, offset)}`, t.openInApp) : null;
    extraRows.push(app ? [app, button(t.menu, 'menu')] : [button(t.menu, 'menu')]);
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
      extraRows: [
        [...[appButton(ctx.t, `day_${appDayKey(mode, offset)}`, ctx.t.openInApp)].filter(Boolean), button(ctx.t.menu, 'help')],
      ],
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
      mode === 'any' ? `${item.title}, ${kindLabel(t, item.kind)}` : item.title,
      payload(item),
    )]);
    rows.push(mode === 'link' ? [button(t.cancel, 'cancel')] : [button(t.menu, 'menu')]);
    return show(ctx, t.searchResults(query), rows);
  };

  const subgroupPrompt = (ctx, group, prefix) => show(ctx, prefix === 'lsub' ? ctx.t.subgroupPromptChat(group.title) : ctx.t.subgroupPrompt(group.title), [[
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

  const lessonWhen = (lang, lesson) => `${formatDate(lang, lesson.date)}, ${lesson.time}`;

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
      `${formatDate(lang, lesson.date, { weekday: 'short', day: 'numeric' })}, ${lesson.time.slice(0, 5)}, ${lesson.subject}`,
      `${prefix}:${lessonKey(lesson)}`,
    )]);
    rows.push([button(t.cancel, 'cancel')]);
    return show(ctx, prompt, rows);
  };

  // Общее ДЗ записывают в чате группы, а староста и редакторы — ещё и из лички.
  const groupConfigFor = async (ctx) => (isGroupChat(ctx)
    ? community.getChat(ctx.chatId)
    : (await community.chatsWithRole(userId(ctx)))[0] ?? null);

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
    const app = appButton(t, items[0] ? `day_${items[0].lessonDate}` : undefined, t.openInApp);
    return show(ctx, formatHomework(lang, items), [[button(t.addPersonal, 'ph:pick')], [...(app ? [app] : []), button(t.menu, 'menu')]]);
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
    const updated = await community.setChat(ctx.chatId, {
      headman: { userId: target.user_id, name: displayName(target), username: target.username ?? null },
    });
    await welcomeRole(ctx, target, 'headman', updated);
    return show(ctx, t.headmanSet(displayName(target)), [[button(t.manage, 'manage'), button(t.menu, 'help')]]);
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
    const updated = await community.setChat(ctx.chatId, { editors });
    if (!exists) await welcomeRole(ctx, target, 'editor', updated);
    return show(ctx, exists ? t.editorRemoved(displayName(target)) : t.editorAdded(displayName(target)), [[button(t.manage, 'manage'), button(t.menu, 'help')]]);
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
    ].join('\n'), [[button(t.manage, 'manage'), button(t.menu, 'help')]]);
  };

  const accessPrompt = async (ctx) => {
    const { t } = ctx;
    if (!isGroupChat(ctx)) return show(ctx, t.helpGroup);
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return show(ctx, t.accessOnlyHeadman);
    return show(ctx, t.accessPrompt, [[button(t.accessEditors, 'acc:editors'), button(t.accessAll, 'acc:all')], [button(t.back, 'manage')]]);
  };

  // Настройки

  const NOTIFY_ITEMS = ['reminders', 'lessonEnd', 'summary', 'homework', 'announcements', 'changes', 'exams'];
  const notifyOn = (prefs, kind) => (kind === 'reminders' ? prefs.remindersEnabled !== false : notificationEnabled({ ...prefs, muted: false }, kind));
  const notifyName = (t, kind, prefs) => {
    if (kind === 'reminders') return t.notifyRemindersAt(reminderMinutes(prefs));
    if (kind === 'summary') return t.notifySummaryAt(summaryTime(prefs));
    return t.notifyNames[kind];
  };

  const showSettings = async (ctx) => {
    const { t, prefs } = ctx;
    if (isGroupChat(ctx)) return groupHelp(ctx);
    const group = ownGroup(prefs);
    const enabled = isMuted(prefs) ? 0 : NOTIFY_ITEMS.filter((kind) => notifyOn(prefs, kind)).length;
    const lines = [
      t.settingsGroup(group?.title),
      group ? t.settingsSubgroup(prefs.subgroup) : '',
      t.settingsNotifySummary(enabled, NOTIFY_ITEMS.length),
      t.settingsLanguage,
    ].filter(Boolean);
    return show(ctx, `${t.settingsTitle}\n\n${lines.join('\n')}`, [
      [button(t.settingsStudy, 'set:study'), button(t.settingsNotifications, 'set:notify')],
      [button(t.accountButton, 'acct'), button(t.changeLanguage, 'set:lang')],
      [button(t.back, 'more')],
    ]);
  };

  const showStudySettings = async (ctx) => {
    const { t, prefs } = ctx;
    const group = ownGroup(prefs);
    const rows = [[button(t.changeGroup, 'set:group')]];
    if (group) rows.push([button(t.changeSubgroup, `set:sub:${group.id}`)], [button(t.invite, 'invite')]);
    rows.push([button(t.back, 'settings')]);
    const lines = [t.settingsGroup(group?.title), group ? t.settingsSubgroup(prefs.subgroup) : ''].filter(Boolean);
    return show(ctx, `${t.studyTitle}\n\n${lines.join('\n')}`, rows);
  };

  const showNotifySettings = async (ctx) => {
    const { t, prefs } = ctx;
    if (isMuted(prefs)) {
      return show(ctx, t.notifyMutedTitle, [[button(t.notifyUnmute, 'set:mute', 'positive')], [button(t.back, 'settings')]]);
    }
    const rows = NOTIFY_ITEMS.map((kind) => [button(t.notifyButton(notifyName(t, kind, prefs), notifyOn(prefs, kind)), `set:n:${kind}`)]);
    rows.push([button(t.notifyReminderTime, 'set:rm'), button(t.notifySummaryTime, 'set:st')]);
    rows.push([button(t.notifyMute, 'set:mute', 'negative')], [button(t.back, 'settings')]);
    return show(ctx, t.notifyTitle, rows);
  };

  // Что бот знает о человеке — прямо и без канцелярита. Отсюда же удаление всех данных.
  const showAccount = async (ctx) => {
    const { t, prefs, lang } = ctx;
    const group = ownGroup(prefs);
    const { headman, editor } = await roleOf(ctx);
    const personal = group ? (await community.homeworkForUser(group.id, userId(ctx), { from: '2000-01-01', subgroup: prefs.subgroup }))
      .filter((item) => item.personalText).length : 0;
    const role = headman ? t.roleHeadman : editor ? t.roleEditor : t.roleStudent;
    return show(ctx, t.accountText({
      name: displayName(ctx.user ?? ctx.message?.sender),
      group: group ? `${group.title}, ${prefs.subgroup ? t.subgroupNumber(prefs.subgroup).toLowerCase() : t.subgroupAll.toLowerCase()}` : null,
      role,
      lang: lang === 'ru' ? 'русский' : 'English',
      personal,
      reminders: Object.keys(prefs.homeworkReminders ?? {}).length,
    }), [
      [button(t.deleteAccount, 'acct:del', 'negative')],
      [button(t.back, 'settings')],
    ]);
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

  // Сообщение старосте: с именем студента, чтобы староста мог отметить его в журнале

  const headmanChatFor = async (groupId) =>
    (await community.chatsForGroup(groupId)).find((chat) => chat.headman?.userId) ?? null;

  const lessonLabel = (lang, lesson) => (lesson
    ? `${texts(lang).changeWhen(formatDate(lang, lesson.date, { weekday: 'short', day: 'numeric', month: 'short' }), String(lesson.time ?? '').slice(0, 5))}, ${lesson.subject}`
    : '');

  const absenceMessage = (notice, lang) => {
    const t = texts(lang);
    return t.absenceToHeadman({
      kind: notice.kind,
      group: notice.groupTitle,
      sender: notice.senderName,
      lesson: lessonLabel(lang, notice.lesson),
      reason: [notice.reasonCode ? t.absenceReasons[notice.reasonCode] : null, notice.text].filter(Boolean).join(' — '),
      minutes: notice.kind === 'late' ? notice.minutes ?? null : null,
      forDeputy: notice.toDeputy === true,
    });
  };

  // Ближайшая пара сегодня: к ней и относится «опоздаю» или «не приду».
  const currentLesson = async (groupId, subgroup) => {
    const today = irkutskDateKey();
    const now = irkutskMinutes();
    try {
      const schedule = await service.groupSchedule(groupId, { week: dateFromKey(today), subgroup });
      return schedule.lessons.find((lesson) => lesson.date === today && lessonEndMinutes(lesson) > now) ?? null;
    } catch {
      return null;
    }
  };

  const sendNotice = async (headmanId, notice) => {
    const lang = (await preferences.get(headmanId)).lang;
    const attachments = [
      ...(notice.images ?? []).map((token) => ({ type: 'image', payload: { token } })),
      Keyboard.inlineKeyboard([[button(texts(lang).accept, `na:${notice.id}`, 'positive')]]),
    ];
    let text = absenceMessage(notice, lang);
    if (notice.status === 'pending') text += `\n\n${texts(lang).absenceDelayed(formatDate(lang, notice.createdAt.slice(0, 10), { day: 'numeric', month: 'long' }))}`;
    await bot.api.sendMessageToUser(headmanId, text, { format: 'markdown', attachments });
  };

  // Если опаздывает сам староста, сообщение уходит одногруппнику, которому он это доверил.
  const deliverAbsence = async ({ user, prefs, kind, reasonCode, text, minutes = null, lesson, images = [] }) => {
    const group = ownGroup(prefs);
    if (!group) return { status: 'no_group' };
    const chat = await headmanChatFor(group.id);
    if (!chat) return { status: 'no_headman' };
    const fromHeadman = String(chat.headman.userId) === String(user.user_id);
    if (fromHeadman && !chat.deputy?.userId) return { status: 'no_deputy' };
    const recipientId = fromHeadman ? chat.deputy.userId : chat.headman.userId;
    const target = lesson === undefined ? await currentLesson(group.id, prefs.subgroup ?? null) : lesson;
    const notice = {
      id: randomUUID(),
      date: irkutskDateKey(),
      chatId: chat.chatId,
      groupId: group.id,
      groupTitle: chat.group.title,
      senderId: user.user_id,
      senderName: senderLabel(user),
      kind,
      reasonCode: reasonCode ?? null,
      text: text ?? null,
      minutes: kind === 'late' ? minutes : null,
      toDeputy: fromHeadman,
      recipientId,
      lesson: target ? { date: target.date, lessonNumber: target.lessonNumber, subject: target.subject, time: target.time } : null,
      images,
    };
    try {
      await sendNotice(recipientId, notice);
      await community.addNotice(notice);
      return { status: 'sent', deputy: fromHeadman ? chat.deputy.name : null };
    } catch {
      await community.addNotice({ ...notice, status: 'pending' });
      return { status: 'pending' };
    }
  };
  bot.sendAbsence = deliverAbsence;

  // Староста не открывал бота — сообщения ждут, пока он нажмёт «Начать» или напишет боту.
  const deliverPending = async (headmanId) => {
    const pending = await community.pendingNoticesForHeadman(headmanId);
    for (const notice of pending) {
      try {
        await sendNotice(headmanId, notice);
        await community.markNoticeSent(notice.id);
      } catch (error) {
        console.error('Pending absence delivery failed:', error.message);
        return;
      }
    }
  };

  const absenceReply = (t, { status, deputy }) => ({
    sent: deputy ? t.absenceSentDeputy(deputy) : t.absenceSent,
    pending: t.absencePending,
    no_headman: t.absenceNoHeadman,
    no_group: t.noGroupYet,
    no_deputy: t.absenceNoDeputy,
  }[status]);

  // Одногруппники, которые пользуются ботом: из них староста выбирает доверенное лицо.
  const groupUsers = async (groupId, exceptId) => (await preferences.entries())
    .filter(([id, prefs]) => String(id) !== String(exceptId) && String(prefs.selection?.id) === String(groupId) && prefs.name)
    .map(([id, prefs]) => ({ userId: Number(id), name: prefs.name }));

  const deputyPicker = async (ctx, page = 0) => {
    const { t } = ctx;
    const [chat] = await headmanChats(ctx);
    if (!chat) return show(ctx, t.lateOnlyHeadman, [[button(t.menu, 'menu')]]);
    const users = await groupUsers(chat.group.id, userId(ctx));
    if (!users.length) return show(ctx, t.deputyNobody, [[button(t.back, 'more')]]);
    const mark = (user) => (String(user.userId) === String(chat.deputy?.userId) ? `✓ ${user.name}` : user.name);
    return show(ctx, t.deputyPrompt(chat.deputy?.name), pagedRows(
      t, users, page, (user) => button(mark(user), `dp:${user.userId}`), 'dpp:', 'more',
    ));
  };

  const beginAbsence = async (ctx) => {
    const { t, prefs } = ctx;
    if (isGroupChat(ctx)) return show(ctx, t.absenceInGroup);
    const group = ownGroup(prefs);
    if (!group) return show(ctx, t.noGroupYet);
    const chat = await headmanChatFor(group.id);
    if (!chat) return show(ctx, t.absenceNoHeadman, [[button(t.menu, 'menu')]]);
    const fromHeadman = String(chat.headman.userId) === String(userId(ctx));
    if (fromHeadman && !chat.deputy?.userId) return deputyPicker(ctx);
    const rows = [
      [button(t.absenceLate, 'abs:late'), button(t.absenceMissing, 'abs:absent')],
    ];
    if (fromHeadman) rows.push([button(t.deputyChange, 'dpp:0')]);
    rows.push([button(t.cancel, 'cancel')]);
    return show(ctx, fromHeadman ? t.absencePromptHeadman(chat.deputy.name) : t.absencePrompt, rows);
  };

  const sendAbsence = async (ctx, state, text) => {
    const { t } = ctx;
    const images = (ctx.message?.body?.attachments ?? [])
      .filter((attachment) => attachment.type === 'image')
      .map((image) => image.payload.token);
    if (!text) return ctx.reply(t.absenceNeedsText);
    setSession(ctx, null);
    const result = await deliverAbsence({
      user: ctx.message.sender, prefs: ctx.prefs, kind: state.kind, text, images, minutes: state.minutes ?? null,
    });
    return show(ctx, absenceReply(t, result), [[button(t.menu, 'menu')]]);
  };

  // Роли: староста и редакторы получают в личку, что они теперь могут

  const botLink = () => (bot.botInfo?.username ? `https://max.ru/${bot.botInfo.username}` : '');

  const welcomeRole = async (ctx, member, role, config) => {
    const lang = (await preferences.get(member.user_id)).lang;
    const t = texts(lang);
    const rows = [[button(t.addGroupHomework, 'gp:pick')]];
    if (role === 'headman') rows[0].push(button(t.lateToday, 'late:0'));
    rows.push([button(t.menu, 'menu')]);
    try {
      await bot.api.sendMessageToUser(
        member.user_id,
        role === 'headman' ? t.headmanWelcome(config.group.title) : t.editorWelcome(config.group.title),
        { format: 'markdown', attachments: [Keyboard.inlineKeyboard(rows)] },
      );
    } catch {
      if (role === 'headman' && isGroupChat(ctx)) {
        await ctx.reply(ctx.t.headmanUnreachable(displayName(member), botLink())).catch(() => {});
      }
    }
  };

  // Сводка «кто опаздывает» для старосты

  const headmanChats = async (ctx) => (await community.chatsWithRole(userId(ctx)))
    .filter((chat) => String(chat.headman?.userId) === String(userId(ctx)));

  const showLateness = async (ctx, offset) => {
    const { t, lang } = ctx;
    const [chat] = await headmanChats(ctx);
    if (!chat) return show(ctx, t.lateOnlyHeadman, [[button(t.menu, 'menu')]]);
    const day = irkutskDateKey(new Date(), offset);
    // Свои сообщения староста отправил доверенному одногруппнику: в сводке группы они лишние.
    const notices = (await community.noticesForDay(chat.group.id, day))
      .filter((item) => String(item.senderId) !== String(userId(ctx)));
    const label = offset === 0 ? t.todayLabel : offset === -1 ? t.yesterday : '';
    const date = formatDate(lang, day, label ? { day: 'numeric', month: 'long' } : undefined);
    const clock = (iso) => new Intl.DateTimeFormat(t.locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Irkutsk' }).format(new Date(iso));
    const sections = ['late', 'absent'].map((kind) => {
      const items = notices.filter((item) => item.kind === kind);
      if (!items.length) return '';
      return [t.lateSection(kind, items.length), ...items.map((item) => t.lateItem(
        item.senderName ?? '—',
        item.lesson ? `${String(item.lesson.time ?? '').slice(0, 5)}, ${item.lesson.subject}` : '',
        item.reasonCode ? t.absenceReasons[item.reasonCode] ?? item.text : item.text,
        clock(item.createdAt),
        Boolean(item.acceptedAt),
      ))].join('\n');
    }).filter(Boolean);
    const text = [t.lateTitle(label, label && lang === 'ru' ? date.toLowerCase() : date, chat.group.title), '', sections.length ? sections.join('\n\n') : t.lateEmpty].join('\n');
    return show(ctx, text, [
      [button(t.yesterday, 'late:-1', offset === -1 ? 'positive' : undefined), button(t.todayLabel, 'late:0', offset === 0 ? 'positive' : undefined)],
      [button(t.menu, 'menu')],
    ]);
  };

  // Объявления старосты: в чат группы и каждому в личку, с напоминанием, которое каждый может сдвинуть у себя

  const announcementWhen = (lang, iso) => {
    if (!iso) return null;
    const date = new Date(iso);
    return `${formatDate(lang, irkutskDateKey(date), { weekday: 'short', day: 'numeric', month: 'short' })}, ${irkutskClock(date)}`;
  };

  const publishAnnouncement = async (item) => {
    let chat = false;
    const config = await community.getChat(item.chatId);
    const t = texts(config?.lang);
    try {
      await bot.api.sendMessageToChat(item.chatId, t.announcementChat(item, announcementWhen(config?.lang, item.remindAt)), { format: 'markdown' });
      chat = true;
    } catch (error) {
      console.error('Announcement to chat failed:', error.message);
    }
    await onAnnouncement?.(item);
    return { chat };
  };
  bot.publishAnnouncement = publishAnnouncement;

  // Варианты времени напоминания: без ввода даты руками для самых частых случаев.
  const reminderChoices = (t) => [
    ['none', t.remindNone], ['1h', t.remind1h], ['eve', t.remindEvening], ['morning', t.remindMorning], ['custom', t.remindCustom],
  ];
  const reminderFromChoice = (choice, now = new Date()) => {
    const today = irkutskDateKey(now);
    if (choice === '1h') return new Date(now.getTime() + 3_600_000).toISOString();
    if (choice === 'eve') {
      const evening = irkutskMoment(today, '19:00');
      return (evening > now ? evening : irkutskMoment(irkutskDateKey(now, 1), '19:00')).toISOString();
    }
    if (choice === 'morning') return irkutskMoment(irkutskDateKey(now, 1), '08:00').toISOString();
    return null;
  };
  // «28.09 13:30», «28.09.2026 13:30» или просто «13:30» (сегодня, а если уже прошло — завтра).
  const parseReminder = (text, now = new Date()) => {
    const match = /^(?:(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+)?(\d{1,2})[:.](\d{2})$/.exec(text.trim());
    if (!match) return null;
    const [, day, month, year, hours, minutes] = match;
    if (Number(hours) > 23 || Number(minutes) > 59) return null;
    const time = `${hours.padStart(2, '0')}:${minutes}`;
    let dateKey = irkutskDateKey(now);
    if (day) dateKey = `${year ?? dateKey.slice(0, 4)}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    let moment = irkutskMoment(dateKey, time);
    if (Number.isNaN(moment.getTime())) return null;
    if (!day && moment <= now) moment = irkutskMoment(irkutskDateKey(now, 1), time);
    return moment > now ? moment.toISOString() : null;
  };

  const beginAnnouncement = async (ctx) => {
    const { t } = ctx;
    const [chat] = await headmanChats(ctx);
    if (!chat) return show(ctx, t.announceOnlyHeadman, [[button(t.back, 'more')]]);
    setSession(ctx, { step: 'ann-text' });
    return show(ctx, t.announcePrompt(chat.group.title), [[button(t.cancel, 'cancel')]]);
  };

  const askAnnouncementReminder = (ctx, text) => {
    setSession(ctx, { step: 'ann-when', text });
    return show(ctx, ctx.t.announceWhen, [
      ...reminderChoices(ctx.t).map(([choice, label]) => [button(label, `anw:${choice}`)]),
      [button(ctx.t.cancel, 'cancel')],
    ]);
  };

  const finishAnnouncement = async (ctx, remindAt) => {
    const { t } = ctx;
    const state = session(ctx);
    const [chat] = await headmanChats(ctx);
    setSession(ctx, null);
    if (!chat || !state.text) return show(ctx, t.selectionExpired, [[button(t.menu, 'menu')]]);
    const sender = ctx.user ?? ctx.message?.sender;
    const item = await community.addAnnouncement({
      groupId: chat.group.id, chatId: chat.chatId, groupTitle: chat.group.title,
      authorId: userId(ctx), authorName: displayName(sender), title: null, text: state.text, eventAt: null, remindAt,
    });
    const { chat: posted } = await publishAnnouncement(item);
    return show(ctx, t.announceDone(posted, announcementWhen(ctx.lang, remindAt)), [[button(t.announcements, 'ann:list'), button(t.menu, 'menu')]]);
  };

  const showAnnouncements = async (ctx) => {
    const { t, lang, prefs } = ctx;
    const group = ownGroup(prefs);
    if (!group) return show(ctx, t.noGroupYet);
    const items = await community.announcementsForGroup(group.id);
    const { headman } = await roleOf(ctx);
    const rows = items.slice(0, 5).map((item, index) => [button(t.announceRemindButton(index + 1), `anm:${item.id}`)]);
    if (headman) rows.push([button(t.newAnnouncement, 'ann:new')]);
    rows.push([button(t.back, 'more')]);
    const lines = items.slice(0, 5).map((item, index) => {
      const own = prefs.announcementReminders?.[item.id];
      const at = own === undefined ? item.remindAt : own;
      return t.announceLine(index + 1, item, announcementWhen(lang, at));
    });
    return show(ctx, [t.announcementsTitle, '', lines.length ? lines.join('\n\n') : t.announcementsEmpty].join('\n'), rows);
  };

  // Первое знакомство после выбора группы: коротко о возможностях и осознанный выбор уведомлений

  const showOnboarding = (ctx, group) => show(ctx, `${ctx.t.onboardingTitle(group.title)}\n\n${ctx.t.onboardingText}`, [
    [button(ctx.t.onboardingAll, 'onb:all', 'positive'), button(ctx.t.onboardingPick, 'onb:pick')],
    [button(ctx.t.onboardingNone, 'onb:none')],
  ]);

  const saveOwnGroup = async (ctx, group, subgroup) => {
    // Смена группы — новый набор дисциплин: формы контроля и напоминания старой группы не нужны.
    const changed = String(ctx.prefs.selection?.id) !== String(group.id);
    await savePrefs(ctx, {
      selection: { kind: 'group', id: group.id, title: group.title },
      institute: group.institute, course: group.course, subgroup,
      ...(changed ? { controls: {}, homeworkReminders: {}, announcementReminders: {} } : {}),
    });
    setSession(ctx, null);
    if (!ctx.prefs.onboarded) return showOnboarding(ctx, group);
    return showSchedule(ctx, 'group', group.id, 'd', 0);
  };

  // Контрольные: экзамены, зачёты и консультации до конца семестра

  const upcomingExams = async (groupId, subgroup) => {
    const today = irkutskDateKey();
    const weeks = await Promise.all(Array.from({ length: SEMESTER_WEEKS }, (_, index) =>
      service.groupSchedule(groupId, { week: addDays(dateFromKey(today), index * 7), subgroup }).catch(() => ({ lessons: [] }))));
    const seen = new Set();
    return weeks.flatMap((week) => week.lessons)
      .filter((lesson) => lesson.date >= today && EXAM_LIST_TYPES.includes(String(lesson.lessonType).toLowerCase()))
      .filter((lesson) => !seen.has(lessonKey(lesson)) && seen.add(lessonKey(lesson)))
      .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  };

  const showExams = async (ctx) => {
    const { t, lang, prefs } = ctx;
    const group = ownGroup(prefs);
    if (!group) return show(ctx, t.noGroupYet);
    const exams = (await upcomingExams(group.id, prefs.subgroup ?? null)).slice(0, 15);
    const today = dateFromKey(irkutskDateKey());
    const lines = exams.map((lesson) => t.examLine(
      formatDate(lang, lesson.date, { weekday: 'short', day: 'numeric', month: 'short' }),
      lesson.time.slice(0, 5),
      lessonTypeLabel(lang, lesson.lessonType),
      lesson.subject,
      lesson.auditories.join(', '),
      t.daysLeft(Math.round((dateFromKey(lesson.date) - today) / 86_400_000)),
    ));
    const app = exams[0] ? appButton(t, `day_${exams[0].date}`, t.openInApp) : null;
    return show(ctx, `${t.examsTitle}\n\n${lines.length ? lines.join('\n\n') : t.examsEmpty}`, [[...(app ? [app] : []), button(t.menu, 'menu')]]);
  };

  // Приглашение: ссылка на бота с payload, новичок сразу попадает в свою группу

  const inviteLink = (group, subgroup) => `${botLink()}?start=group_${group.id}_${subgroup ?? 0}`;

  const showInvite = async (ctx) => {
    const { t } = ctx;
    const config = isGroupChat(ctx) ? await community.getChat(ctx.chatId) : null;
    const group = isGroupChat(ctx) ? config?.group : ownGroup(ctx.prefs);
    if (!group) return show(ctx, isGroupChat(ctx) ? t.groupNotConfigured : t.noGroupYet);
    const subgroup = isGroupChat(ctx) ? config.subgroup ?? null : ctx.prefs.subgroup ?? null;
    return show(ctx, t.inviteText(group.title, inviteLink(group, subgroup)), [[button(t.back, isGroupChat(ctx) ? 'manage' : 'set:study')]]);
  };

  const invitePrompt = async (ctx, payload) => {
    const match = /^group_(\d+)_([012])$/.exec(payload ?? '');
    if (!match) return null;
    const group = await findGroup(match[1]);
    if (!group) return null;
    const subgroup = subgroupFromCode(match[2]);
    return show(ctx, ctx.t.invitePrompt(group.title, subgroup), [
      [button(ctx.t.inviteYes, `sub:${group.id}:${subgroup ?? 'all'}`, 'positive')],
      [button(ctx.t.inviteOther, 'set:group')],
    ]);
  };

  // Управление чатом группы кнопками: список участников вместо ответа командой на сообщение

  const chatMembers = async (ctx) => {
    const members = [];
    let marker;
    for (let page = 0; page < 5; page += 1) {
      const response = await bot.api.getChatMembers(ctx.chatId, { count: 100, ...(marker ? { marker } : {}) });
      members.push(...(response.members ?? []).filter((member) => !member.is_bot));
      marker = response.marker;
      if (!marker) break;
    }
    return members;
  };

  const showManage = async (ctx) => {
    const { t } = ctx;
    if (!isGroupChat(ctx)) return privateMenu(ctx);
    const config = await community.getChat(ctx.chatId);
    const rows = [[button(t.manageSetup, 'm:setup')]];
    if (config?.group) {
      rows.push([button(t.manageHeadman, 'm:head:0')], [button(t.manageEditors, 'm:ed:0')], [button(t.manageAccess, 'm:acc')], [button(t.invite, 'invite')]);
    }
    rows.push([button(t.manageLanguage, 'm:lang')], [button(t.menu, 'help')]);
    return show(ctx, t.manageTitle(config?.group?.title), rows);
  };

  const memberPicker = async (ctx, mode, page) => {
    const { t } = ctx;
    const config = await community.getChat(ctx.chatId);
    if (!config?.group) return show(ctx, t.groupNotConfigured, [[button(t.setup, 'setup', 'positive')]]);
    let members;
    try {
      members = await chatMembers(ctx);
    } catch (error) {
      console.error('Chat members request failed:', error.message);
      return show(ctx, t.membersUnavailable, [[button(t.back, 'manage')]]);
    }
    if (!members.length) return show(ctx, t.membersEmpty, [[button(t.back, 'manage')]]);
    const editors = new Set((config.editors ?? []).map((editor) => String(editor.userId)));
    const label = (member) => {
      const name = displayName(member);
      if (String(member.user_id) === String(config.headman?.userId)) return `${name}${t.memberHeadmanMark}`;
      if (editors.has(String(member.user_id))) return `${name}${t.memberEditorMark}`;
      return name;
    };
    const prefix = mode === 'head' ? 'hs' : 'es';
    return show(ctx, mode === 'head' ? t.membersHeadmanPrompt : t.membersEditorPrompt, pagedRows(
      t, members, page, (member) => button(label(member), `${prefix}:${member.user_id}`), `m:${mode}:`, 'manage',
    ));
  };

  const findMember = async (ctx, id) => (await chatMembers(ctx).catch(() => []))
    .find((member) => String(member.user_id) === String(id));

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
      return show(ctx, ctx.t.searchPrompt, [[button(ctx.t.menu, 'menu')]]);
    },
    settings: showSettings,
    language: async (ctx, args) => {
      const next = normalizeLanguage(args.toLowerCase());
      await switchLanguage(ctx, next);
      if (!isGroupChat(ctx)) return privateMenu(ctx);
      return null;
    },
    absence: beginAbsence,
    news: (ctx) => (isGroupChat(ctx) ? groupHelp(ctx) : showAnnouncements(ctx)),
    setup: beginSetup,
    manage: (ctx) => (isGroupChat(ctx) ? showManage(ctx) : moreMenu(ctx)),
    // Назначение — всегда выбором из списка участников; ответ командой на сообщение остался запасным путём.
    headman: async (ctx) => {
      if (!isGroupChat(ctx)) return show(ctx, ctx.t.helpGroup);
      if (replyTarget(ctx)) return assignHeadman(ctx);
      if (!await isChatManager(ctx)) return show(ctx, ctx.t.needChatAdmin);
      return memberPicker(ctx, 'head', 0);
    },
    editor: async (ctx) => {
      if (!isGroupChat(ctx)) return show(ctx, ctx.t.helpGroup);
      if (replyTarget(ctx)) return toggleEditor(ctx);
      const config = await community.getChat(ctx.chatId);
      if (!config?.headman || userId(ctx) !== config.headman.userId) return show(ctx, ctx.t.editorOnlyHeadman);
      return memberPicker(ctx, 'ed', 0);
    },
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
    if (id && !isGroupChat(ctx)) await deliverPending(id).catch((error) => console.error('Pending check failed:', error.message));
    // Имя нужно старосте, чтобы выбрать доверенного одногруппника из списка.
    const sender = ctx.user ?? ctx.message?.sender;
    if (id && !isGroupChat(ctx) && ctx.prefs.selection && sender && ctx.prefs.name !== displayName(sender)) {
      ctx.prefs = await preferences.set(id, { ...ctx.prefs, name: displayName(sender) });
    }
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
    return saveOwnGroup(ctx, group, subgroupFromCode(ctx.match[2]));
  });
  bot.action(/^onb:(all|pick|none)$/, async (ctx) => {
    const { t } = ctx;
    const choice = ctx.match[1];
    if (choice === 'pick') {
      await savePrefs(ctx, { onboarded: true });
      return showNotifySettings(ctx);
    }
    const on = choice === 'all';
    await savePrefs(ctx, {
      onboarded: true,
      remindersEnabled: on,
      muted: false,
      notifications: Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, kind === 'lessonEnd' ? false : on])),
    });
    const group = ownGroup(ctx.prefs);
    return show(ctx, on ? t.onboardingDone : t.onboardingOff, [
      ...(group ? [[button(t.today, `s:group:${group.id}:d0`, 'positive'), button(t.week, `s:group:${group.id}:w0`)]] : []),
      [button(t.menu, 'menu')],
    ]);
  });
  bot.action('na:noop', (ctx) => toast(ctx, ctx.t.acceptedToast));
  bot.action(/^na:([0-9a-f-]{36})$/, async (ctx) => {
    const { t, lang } = ctx;
    const notice = await community.getNotice(ctx.match[1]);
    if (!notice) return toast(ctx, t.selectionExpired);
    const chat = await community.getChat(notice.chatId);
    const recipient = notice.recipientId ?? chat?.headman?.userId;
    if (String(recipient) !== String(userId(ctx))) return toast(ctx, t.onlyHeadmanToast);
    const already = Boolean(notice.acceptedAt);
    await community.acceptNotice(notice.id);
    if (!already) {
      const studentLang = (await preferences.get(notice.senderId)).lang;
      await bot.api.sendMessageToUser(notice.senderId, texts(studentLang).studentAccepted(notice.kind, lessonLabel(studentLang, notice.lesson)))
        .catch((error) => console.error('Accept notification failed:', error.message));
    }
    const images = (ctx.message?.body?.attachments ?? [])
      .filter((attachment) => attachment.type === 'image')
      .map((image) => ({ type: 'image', payload: { token: image.payload.token } }));
    return ctx.answerOnCallback({
      notification: t.acceptedToast,
      message: {
        text: clip(`${absenceMessage(notice, lang)}\n\n${t.acceptedMark}`),
        format: 'markdown',
        attachments: [...images, Keyboard.inlineKeyboard([[button(`${t.accept} ✓`, 'na:noop')]])],
      },
    });
  });
  bot.action(/^late:(0|-1)$/, (ctx) => showLateness(ctx, Number(ctx.match[1])));
  bot.action('exams', showExams);
  bot.action('invite', showInvite);

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
    return show(ctx, `**${institute}**, ${ctx.t.courseLabel(course)}\n\n${ctx.t.pickGroup}`,
      pagedRows(ctx.t, groups, Number(page), (group) => button(group.title, `mine:${group.id}`),
        `grp:${instituteIndex}:${course}:`, `crs:${instituteIndex}`));
  });

  bot.action('settings', showSettings);
  bot.action('more', moreMenu);
  bot.action('g:more', groupMore);
  bot.action('acct', showAccount);
  bot.action('acct:del', (ctx) => show(ctx, ctx.t.deleteConfirm, [
    [button(ctx.t.deleteYes, 'acct:del:yes', 'negative')],
    [button(ctx.t.cancel, 'acct')],
  ]));
  bot.action('acct:del:yes', async (ctx) => {
    const { t } = ctx;
    setSession(ctx, null);
    await community.removeUser(userId(ctx));
    await preferences.delete(userId(ctx));
    return show(ctx, t.deleteDone, [[button(t.startAgain, 'restart')]]);
  });
  bot.action('restart', (ctx) => languagePrompt(ctx));
  bot.action('set:mute', async (ctx) => {
    await savePrefs(ctx, { muted: !isMuted(ctx.prefs) });
    return showNotifySettings(ctx);
  });
  bot.action('set:rm', async (ctx) => {
    const current = reminderMinutes(ctx.prefs);
    const next = REMINDER_MINUTES[(REMINDER_MINUTES.indexOf(current) + 1) % REMINDER_MINUTES.length];
    await savePrefs(ctx, { reminderMinutes: next, remindersEnabled: true });
    return showNotifySettings(ctx);
  });
  bot.action('set:st', async (ctx) => {
    const current = summaryTime(ctx.prefs);
    const next = SUMMARY_TIMES[(SUMMARY_TIMES.indexOf(current) + 1) % SUMMARY_TIMES.length];
    await savePrefs(ctx, { summaryTime: next, summarySentFor: null, notifications: { ...ctx.prefs.notifications, summary: true } });
    return showNotifySettings(ctx);
  });
  bot.action('ann:list', showAnnouncements);
  bot.action('ann:new', beginAnnouncement);
  bot.action(/^anw:(none|1h|eve|morning|custom)$/, async (ctx) => {
    const choice = ctx.match[1];
    const state = session(ctx);
    if (state.step !== 'ann-when') return toast(ctx, ctx.t.selectionExpired);
    if (choice === 'custom') {
      setSession(ctx, { ...state, step: 'ann-when-custom' });
      return show(ctx, ctx.t.remindCustomPrompt, [[button(ctx.t.cancel, 'cancel')]]);
    }
    return finishAnnouncement(ctx, reminderFromChoice(choice));
  });
  bot.action(/^anm:([0-9a-f-]{36})$/, async (ctx) => {
    const { t, lang } = ctx;
    const item = await community.getAnnouncement(ctx.match[1]);
    if (!item) return toast(ctx, t.selectionExpired);
    const own = ctx.prefs.announcementReminders?.[item.id];
    const at = own === undefined ? item.remindAt : own;
    return show(ctx, t.announceRemindPrompt(item, announcementWhen(lang, at), own !== undefined), [
      ...reminderChoices(t).map(([choice, label]) => [button(label, `ans:${item.id}:${choice}`)]),
      ...(own !== undefined && item.remindAt ? [[button(t.remindReset, `ans:${item.id}:reset`)]] : []),
      [button(t.back, 'ann:list')],
    ]);
  });
  bot.action(/^ans:([0-9a-f-]{36}):(none|1h|eve|morning|custom|reset)$/, async (ctx) => {
    const [, id, choice] = ctx.match;
    const item = await community.getAnnouncement(id);
    if (!item) return toast(ctx, ctx.t.selectionExpired);
    if (choice === 'custom') {
      setSession(ctx, { step: 'ann-remind-custom', id });
      return show(ctx, ctx.t.remindCustomPrompt, [[button(ctx.t.cancel, 'cancel')]]);
    }
    const reminders = { ...ctx.prefs.announcementReminders };
    if (choice === 'reset') delete reminders[id];
    else reminders[id] = reminderFromChoice(choice);
    await savePrefs(ctx, { announcementReminders: reminders });
    await ctx.answerOnCallback({ notification: ctx.t.remindSaved }).catch(() => {});
    return showAnnouncements(ctx);
  });
  bot.action(/^dpp:(\d+)$/, (ctx) => deputyPicker(ctx, Number(ctx.match[1])));
  bot.action(/^dp:(\d+)$/, async (ctx) => {
    const { t } = ctx;
    const [chat] = await headmanChats(ctx);
    if (!chat) return toast(ctx, t.lateOnlyHeadman);
    const user = (await groupUsers(chat.group.id, userId(ctx))).find((item) => String(item.userId) === ctx.match[1]);
    if (!user) return toast(ctx, t.selectionExpired);
    await community.setChat(chat.chatId, { deputy: user });
    return show(ctx, t.deputySaved(user.name), [
      [button(t.absenceLate, 'abs:late'), button(t.absenceMissing, 'abs:absent')],
      [button(t.menu, 'menu')],
    ]);
  });
  bot.action('set:group', (ctx) => {
    setSession(ctx, { step: 'own-group' });
    return show(ctx, ctx.t.changeGroupPrompt, [[button(ctx.t.chooseByInstitute, 'inst:0')], [button(ctx.t.back, 'set:study')]]);
  });
  bot.action(/^set:sub:(\d+)$/, async (ctx) => {
    const group = await findGroup(ctx.match[1]);
    if (!group) return toast(ctx, ctx.t.selectionExpired);
    return subgroupPrompt(ctx, group, 'sub');
  });
  bot.action('set:rem', async (ctx) => {
    await savePrefs(ctx, { remindersEnabled: ctx.prefs.remindersEnabled === false });
    return showNotifySettings(ctx);
  });
  bot.action('set:study', showStudySettings);
  bot.action('set:notify', showNotifySettings);
  bot.action(/^set:n:(reminders|lessonEnd|summary|homework|announcements|changes|exams)$/, async (ctx) => {
    const kind = ctx.match[1];
    await savePrefs(ctx, kind === 'reminders'
      ? { remindersEnabled: ctx.prefs.remindersEnabled === false }
      : { notifications: { ...ctx.prefs.notifications, [kind]: !notifyOn(ctx.prefs, kind) } });
    return showNotifySettings(ctx);
  });
  bot.action('set:lang', async (ctx) => {
    await switchLanguage(ctx);
    return showSettings(ctx);
  });

  bot.action('absence', beginAbsence);
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
  bot.action('gp:pick', async (ctx) => {
    const { t } = ctx;
    const config = await groupConfigFor(ctx);
    if (!config?.group || !canEditHomework(ctx, config)) return toast(ctx, t.homeworkForbidden);
    return lessonPicker(ctx, config.group.id, config.subgroup ?? null, 'gh', t.homeworkLessonPrompt);
  });
  bot.action(/^gh:(\d{4}-\d{2}-\d{2}:\d+:\d+)$/, async (ctx) => {
    const { t, lang } = ctx;
    const config = await groupConfigFor(ctx);
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

  // Опоздание: сначала «на сколько», потом причина. Минуты попадают в «досье» у старосты.
  const reasonRows = (t, kind, minutes) => {
    const suffix = minutes ? `:${minutes}` : '';
    return [
      ...ABSENCE_REASONS[kind].map((code) => [button(t.absenceReasons[code], `abr:${kind}:${code}${suffix}`)]),
      [button(t.absenceOwnReason, `abo:${kind}${suffix}`)],
      [button(t.cancel, 'cancel')],
    ];
  };
  bot.action('abs:late', (ctx) => {
    const { t } = ctx;
    const buttons = LATE_MINUTES.map((minutes) => button(t.minutesShort(minutes), `abm:${minutes}`));
    return show(ctx, t.absenceMinutesPrompt, [buttons.slice(0, 3), buttons.slice(3), [button(t.cancel, 'cancel')]]);
  });
  bot.action(/^abm:(\d+)$/, (ctx) => {
    const minutes = Number(ctx.match[1]);
    if (!LATE_MINUTES.includes(minutes)) return toast(ctx, ctx.t.selectionExpired);
    return show(ctx, ctx.t.absenceReasonPrompt('late'), reasonRows(ctx.t, 'late', minutes));
  });
  bot.action('abs:absent', (ctx) => show(ctx, ctx.t.absenceReasonPrompt('absent'), reasonRows(ctx.t, 'absent')));
  bot.action(/^abr:(late|absent):([a-z0-9]+)(?::(\d+))?$/, async (ctx) => {
    const [, kind, reasonCode, minutes] = ctx.match;
    if (!ABSENCE_REASONS[kind].includes(reasonCode)) return toast(ctx, ctx.t.selectionExpired);
    const result = await deliverAbsence({ user: ctx.user, prefs: ctx.prefs, kind, reasonCode, minutes: minutes ? Number(minutes) : null });
    return show(ctx, absenceReply(ctx.t, result), [[button(ctx.t.menu, 'menu')]]);
  });
  bot.action(/^abo:(late|absent)(?::(\d+))?$/, (ctx) => {
    setSession(ctx, { step: 'absence-text', kind: ctx.match[1], minutes: ctx.match[2] ? Number(ctx.match[2]) : null });
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
  bot.action('manage', showManage);
  bot.action('m:setup', async (ctx) => {
    if (!await isChatManager(ctx)) return toast(ctx, ctx.t.onlyAdminToast);
    return beginSetup(ctx);
  });
  bot.action(/^m:head:(\d+)$/, async (ctx) => {
    if (!await isChatManager(ctx)) return toast(ctx, ctx.t.onlyAdminToast);
    return memberPicker(ctx, 'head', Number(ctx.match[1]));
  });
  bot.action(/^m:ed:(\d+)$/, async (ctx) => {
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return toast(ctx, ctx.t.onlyHeadmanToast);
    return memberPicker(ctx, 'ed', Number(ctx.match[1]));
  });
  bot.action('m:acc', async (ctx) => {
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return toast(ctx, ctx.t.onlyHeadmanToast);
    return accessPrompt(ctx);
  });
  bot.action('m:lang', async (ctx) => {
    if (!await isChatManager(ctx)) return toast(ctx, ctx.t.onlyAdminToast);
    const config = await community.getChat(ctx.chatId);
    const lang = (config?.lang ?? ctx.lang) === 'ru' ? 'en' : 'ru';
    await community.setChat(ctx.chatId, { lang });
    ctx.lang = lang;
    ctx.t = texts(lang);
    return showManage(ctx);
  });
  bot.action(/^hs:(\d+)$/, async (ctx) => {
    const { t } = ctx;
    if (!await isChatManager(ctx)) return toast(ctx, t.onlyAdminToast);
    const member = await findMember(ctx, ctx.match[1]);
    if (!member) return toast(ctx, t.selectionExpired);
    const updated = await community.setChat(ctx.chatId, {
      headman: { userId: member.user_id, name: displayName(member), username: member.username ?? null },
    });
    await welcomeRole(ctx, member, 'headman', updated);
    return show(ctx, t.headmanSet(displayName(member)), [[button(t.manage, 'manage'), button(t.menu, 'help')]]);
  });
  bot.action(/^es:(\d+)$/, async (ctx) => {
    const { t } = ctx;
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return toast(ctx, t.onlyHeadmanToast);
    const member = await findMember(ctx, ctx.match[1]);
    if (!member) return toast(ctx, t.selectionExpired);
    const current = config.editors ?? [];
    const exists = current.some((editor) => String(editor.userId) === String(member.user_id));
    const editors = exists
      ? current.filter((editor) => String(editor.userId) !== String(member.user_id))
      : [...current, { userId: member.user_id, name: displayName(member), username: member.username ?? null }];
    const updated = await community.setChat(ctx.chatId, { editors });
    if (!exists) await welcomeRole(ctx, member, 'editor', updated);
    return memberPicker(ctx, 'ed', 0);
  });
  bot.action(/^acc:(editors|all)$/, async (ctx) => {
    const config = await community.getChat(ctx.chatId);
    if (!config?.headman || userId(ctx) !== config.headman.userId) return toast(ctx, ctx.t.accessOnlyHeadman);
    await community.setChat(ctx.chatId, { homeworkMode: ctx.match[1] });
    return show(ctx, ctx.t.accessSaved(ctx.match[1] === 'all'), [[button(ctx.t.manage, 'manage'), button(ctx.t.menu, 'help')]]);
  });

  // Сообщения: команды, ввод по шагам, поиск

  const saveGroupHomework = async (ctx, state, text) => {
    const { t } = ctx;
    const config = await groupConfigFor(ctx);
    setSession(ctx, null);
    if (!config?.group || !canEditHomework(ctx, config)) return ctx.reply(t.homeworkRightsChanged);
    const { lesson } = state;
    const item = await community.upsertHomework({
      chatId: config.chatId,
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
    onHomeworkSaved?.(item);
    return show(ctx, t.homeworkSaved(lesson.subject), [[button(t.homework, 'hw:list'), button(t.menu, isGroupChat(ctx) ? 'help' : 'menu')]]);
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
    if (state.step === 'ann-text') {
      if (!text) return ctx.reply(ctx.t.announceNeedsText);
      if (text.length > 1_500) return ctx.reply(ctx.t.announceTooLong);
      return askAnnouncementReminder(ctx, text);
    }
    if (state.step === 'ann-when-custom') {
      const remindAt = parseReminder(text);
      if (!remindAt) return ctx.reply(ctx.t.remindCustomInvalid);
      return finishAnnouncement(ctx, remindAt);
    }
    if (state.step === 'ann-remind-custom') {
      const remindAt = parseReminder(text);
      if (!remindAt) return ctx.reply(ctx.t.remindCustomInvalid);
      setSession(ctx, null);
      await savePrefs(ctx, { announcementReminders: { ...ctx.prefs.announcementReminders, [state.id]: remindAt } });
      return show(ctx, `${ctx.t.remindSaved}, ${announcementWhen(ctx.lang, remindAt)}`, [[button(ctx.t.announcements, 'ann:list'), button(ctx.t.menu, 'menu')]]);
    }
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
