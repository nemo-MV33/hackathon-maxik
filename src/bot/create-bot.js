import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { addDays, formatHumanDate, toDateKey } from '../lib/date.js';
import { formatSchedule, formatSearchResults, formatWeekTitle } from './format.js';

const PAGE_SIZE = 8;
const sessions = new Map();
const userId = (ctx) => ctx.user?.user_id ?? ctx.message?.sender?.user_id ?? ctx.chatId;
const sessionFor = (ctx) => sessions.get(userId(ctx)) ?? {};
const saveSession = (ctx, patch) => {
  const value = { ...sessionFor(ctx), ...patch };
  sessions.set(userId(ctx), value);
  return value;
};
const buttonText = (value) => String(value).slice(0, 54);
const isGroupChat = (ctx) => ctx.message?.recipient?.chat_type === 'chat';
const displayName = (user) => user?.name || (user?.username ? `@${user.username}` : `MAX ID ${user?.user_id}`);

const groupMenu = () => Keyboard.inlineKeyboard([
  [
    Keyboard.button.callback('Сегодня', 'group-schedule:today'),
    Keyboard.button.callback('Завтра', 'group-schedule:tomorrow'),
    Keyboard.button.callback('Неделя', 'group-schedule:week'),
  ],
  [
    Keyboard.button.callback('Домашнее задание', 'group-homework:list'),
    Keyboard.button.callback('Добавить ДЗ', 'group-homework:create'),
  ],
]);

const setupKeyboard = () => Keyboard.inlineKeyboard([
  [Keyboard.button.callback('Настроить учебную группу', 'group-setup:start', { intent: 'positive' })],
]);

const mainKeyboard = (miniAppUrl) => {
  const rows = [
    [Keyboard.button.callback('Моё расписание', 'menu:mine', { intent: 'positive' })],
    [
      Keyboard.button.callback('Группа', 'menu:group'),
      Keyboard.button.callback('Преподаватель', 'menu:teacher'),
      Keyboard.button.callback('Аудитория', 'menu:auditory'),
    ],
    [Keyboard.button.callback('Мой профиль', 'profile:view')],
  ];
  if (miniAppUrl) rows.push([Keyboard.button.link('Открыть приложение', miniAppUrl)]);
  return Keyboard.inlineKeyboard(rows);
};

const replyMenu = (ctx, miniAppUrl) => ctx.reply([
  '**norfly — расписание ИРНИТУ**', '',
  'Расписание группы, преподавателя или аудитории в одном месте.',
].join('\n'), { format: 'markdown', attachments: [mainKeyboard(miniAppUrl)] });

const pagedKeyboard = (items, kind, page, labelOf) => {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const rows = items.slice(start, start + PAGE_SIZE).map((item, offset) => [
    Keyboard.button.callback(buttonText(labelOf(item)), `pick:${kind}:${start + offset}`),
  ]);
  const navigation = [];
  if (safePage > 0) navigation.push(Keyboard.button.callback('← Назад', `page:${kind}:${safePage - 1}`));
  navigation.push(Keyboard.button.callback(`${safePage + 1}/${totalPages}`, 'noop'));
  if (safePage + 1 < totalPages) navigation.push(Keyboard.button.callback('Дальше →', `page:${kind}:${safePage + 1}`));
  rows.push(navigation);
  const backLabels = {
    institute: '← Главное меню',
    course: '← Изменить институт',
    studentGroup: '← Изменить курс',
    result: '← Главное меню',
  };
  rows.push([Keyboard.button.callback(backLabels[kind], `back:${kind}`)]);
  return Keyboard.inlineKeyboard(rows);
};

const renderPicker = async (ctx, kind, page = 0) => {
  const session = sessionFor(ctx);
  const titles = {
    institute: 'Выбери институт:', course: 'Выбери курс:',
    studentGroup: 'Выбери группу:', result: 'Выбери подходящий вариант:',
  };
  const labelOf = {
    institute: (item) => item,
    course: (item) => `${item} курс`,
    studentGroup: (item) => item.title,
    result: (item) => item.title || item.fullName,
  }[kind];
  await ctx.reply(titles[kind], {
    attachments: [pagedKeyboard(session.candidates ?? [], kind, page, labelOf)],
  });
};

const isChatManager = async (ctx) => {
  try {
    const response = await ctx.getChatAdmins();
    return response.members?.some((member) => member.user_id === userId(ctx) && (member.is_owner || member.is_admin));
  } catch {
    return false;
  }
};

const requireChatManager = async (ctx) => {
  if (await isChatManager(ctx)) return true;
  await ctx.reply('Настраивать бота может владелец или администратор чата. Добавь бота в администраторы с правом чтения сообщений и повтори команду.');
  return false;
};

const formatHomework = (items) => {
  if (!items.length) return 'Актуальных домашних заданий пока нет.';
  return ['**Домашнее задание**', '', ...items.flatMap((item) => [
    `📅 **${formatHumanDate(item.lessonDate)} · ${item.lessonTime}**`,
    `**${item.subject}**`,
    item.text,
    '',
  ])].join('\n').trim();
};

const persistProfile = async (ctx, preferences, patch) => {
  const saved = await preferences.get(userId(ctx));
  const value = { ...saved, ...patch };
  await preferences.set(userId(ctx), value);
  return value;
};

const beginStudentSetup = async (ctx, service) => {
  const institutes = await service.institutes();
  saveSession(ctx, { step: 'institute', institutes, candidates: institutes });
  await renderPicker(ctx, 'institute');
};

const beginSearch = async (ctx, kind) => {
  saveSession(ctx, { step: `search:${kind}`, candidates: [] });
  const labels = {
    group: 'Напиши название группы, например ИСТб-26-1.',
    teacher: 'Напиши фамилию преподавателя.',
    auditory: 'Напиши аудиторию, например Б-307.',
  };
  await ctx.reply(labels[kind]);
};

const scheduleKeyboard = (mode) => {
  const rows = [[
    Keyboard.button.callback('Сегодня', 'schedule:today'),
    Keyboard.button.callback('Завтра', 'schedule:tomorrow'),
    Keyboard.button.callback('Неделя', 'schedule:week', { intent: mode === 'week' ? 'positive' : 'default' }),
  ]];
  if (mode === 'week') rows.push([
    Keyboard.button.callback('← Неделя', 'week:previous'),
    Keyboard.button.callback('Текущая', 'week:current'),
    Keyboard.button.callback('Неделя →', 'week:next'),
  ]);
  rows.push([
    Keyboard.button.callback('Профиль', 'profile:view'),
    Keyboard.button.callback('Меню', 'menu:main'),
  ]);
  return Keyboard.inlineKeyboard(rows);
};

const showSchedule = async (ctx, service, mode = 'today') => {
  const session = sessionFor(ctx);
  if (!session.selection) return ctx.reply('Сначала выбери своё расписание через главное меню.');
  const offset = mode === 'week' ? (session.weekOffset ?? 0) : 0;
  const baseDate = addDays(new Date(), offset * 7);
  const targetDate = mode === 'tomorrow' ? addDays(new Date(), 1) : baseDate;
  const schedule = await service[`${session.selection.kind}Schedule`](session.selection.id, {
    week: targetDate, subgroup: session.subgroup,
  });
  const body = formatSchedule(schedule, {
    date: mode === 'week' ? undefined : targetDate,
  });
  const text = mode === 'week' ? `${formatWeekTitle(schedule)}\n\n${body}` : body;
  await ctx.reply(text, { format: 'markdown', attachments: [scheduleKeyboard(mode)] });
};

const showProfile = async (ctx, preferences) => {
  const saved = await preferences.get(userId(ctx));
  const user = ctx.user ?? {};
  const lines = [
    '**Мой профиль**', '',
    `Имя: ${user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'не указано'}`,
    user.username ? `Ник: @${user.username}` : '',
    `MAX ID: ${userId(ctx)}`,
    '',
    saved.institute ? `Институт: ${saved.institute}` : 'Институт: не выбран',
    saved.course ? `Курс: ${saved.course}` : 'Курс: не выбран',
    saved.selection?.kind === 'group' ? `Группа: ${saved.selection.title}` : 'Группа: не выбрана',
    saved.selection?.kind === 'group'
      ? `Подгруппа: ${saved.subgroup ?? 'вся группа'}`
      : '',
    `Напоминания: ${saved.remindersEnabled === false ? 'выключены' : 'включены'}`,
  ].filter(Boolean);
  await ctx.reply(lines.join('\n'), {
    format: 'markdown',
    attachments: [Keyboard.inlineKeyboard([
      [Keyboard.button.callback('Изменить учебные данные', 'profile:change')],
      [Keyboard.button.callback(
        saved.remindersEnabled === false ? 'Включить напоминания' : 'Выключить напоминания',
        'profile:toggle-reminders',
      )],
      [Keyboard.button.callback('Главное меню', 'menu:main')],
    ])],
  });
};

export const createBot = ({ token, service, miniAppUrl, preferences, community }) => {
  const bot = new Bot(token);
  const restoreProfile = async (ctx) => {
    const current = sessionFor(ctx);
    if (current.restored) return current;
    const saved = await preferences.get(userId(ctx));
    return saveSession(ctx, { ...saved, restored: true });
  };

  const beginGroupSetup = async (ctx) => {
    if (!isGroupChat(ctx) || !await requireChatManager(ctx)) return;
    const institutes = await service.institutes();
    saveSession(ctx, {
      step: 'institute', institutes, candidates: institutes,
      groupSetup: { chatId: ctx.chatId },
    });
    await renderPicker(ctx, 'institute');
  };

  const groupConfigFor = async (ctx) => community.getChat(ctx.chatId);

  const showGroupSchedule = async (ctx, mode = 'today') => {
    const config = await groupConfigFor(ctx);
    if (!config?.group) {
      await ctx.reply('Чат ещё не привязан к учебной группе.', { attachments: [setupKeyboard()] });
      return;
    }
    const targetDate = mode === 'tomorrow' ? addDays(new Date(), 1) : new Date();
    const schedule = await service.groupSchedule(config.group.id, {
      week: targetDate,
      subgroup: config.subgroup ?? null,
    });
    const body = formatSchedule(schedule, { date: mode === 'week' ? undefined : targetDate });
    const text = mode === 'week' ? `${formatWeekTitle(schedule)}\n\n${body}` : body;
    await ctx.reply(text, { format: 'markdown', attachments: [groupMenu()] });
  };

  const homeworkForContext = async (ctx) => {
    let groupId;
    if (isGroupChat(ctx)) groupId = (await groupConfigFor(ctx))?.group?.id;
    else groupId = (await preferences.get(userId(ctx)))?.selection?.id;
    if (!groupId) {
      await ctx.reply(isGroupChat(ctx)
        ? 'Сначала настрой учебную группу командой /setup.'
        : 'Сначала выбери свою группу в профиле.');
      return;
    }
    const items = await community.homeworkForGroup(groupId);
    await ctx.reply(formatHomework(items), { format: 'markdown' });
  };

  const canEditHomework = async (ctx, config) => {
    if (!config) return false;
    if (config.homeworkMode === 'all') return true;
    const actorId = userId(ctx);
    return actorId === config.headman?.userId || (config.editors ?? []).some((editor) => editor.userId === actorId);
  };

  const beginHomework = async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Добавлять ДЗ нужно в чате учебной группы. В личке можно посмотреть уже записанное через /homework.');
      return;
    }
    const config = await groupConfigFor(ctx);
    if (!config?.group) return ctx.reply('Сначала настрой учебную группу командой /setup.');
    if (!await canEditHomework(ctx, config)) {
      await ctx.reply('Добавлять ДЗ сейчас могут староста и назначенные редакторы.');
      return;
    }
    const thisWeek = await service.groupSchedule(config.group.id, { week: new Date(), subgroup: config.subgroup ?? null });
    const nextWeek = await service.groupSchedule(config.group.id, { week: addDays(new Date(), 7), subgroup: config.subgroup ?? null });
    const today = toDateKey(new Date());
    const lessons = [...thisWeek.lessons, ...nextWeek.lessons]
      .filter((lesson) => lesson.date >= today)
      .filter((lesson, index, all) => all.findIndex((candidate) =>
        candidate.date === lesson.date && candidate.time === lesson.time && candidate.subject === lesson.subject) === index)
      .slice(0, 12);
    if (!lessons.length) return ctx.reply('В ближайших двух неделях занятий не найдено.');
    saveSession(ctx, { step: 'homework:lesson', homeworkChatId: ctx.chatId, homeworkLessons: lessons });
    const rows = lessons.map((lesson, index) => [Keyboard.button.callback(
      buttonText(`${formatHumanDate(lesson.date)} · ${lesson.time} · ${lesson.subject}`),
      `homework:lesson:${index}`,
    )]);
    rows.push([Keyboard.button.callback('Отмена', 'homework:cancel')]);
    await ctx.reply('К какой паре записать домашнее задание?', {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  };

  const beginNotice = async (ctx) => {
    if (isGroupChat(ctx)) {
      await ctx.reply('Сообщение старосте отправляется из личного чата с ботом — так причина и фото не попадут в общий чат.');
      return;
    }
    const profile = await preferences.get(userId(ctx));
    const chats = profile.selection?.id ? await community.chatsForGroup(profile.selection.id) : [];
    const configured = chats.filter((chat) => chat.headman?.userId);
    if (!configured.length) {
      await ctx.reply('Для твоей группы ещё не настроен чат со старостой. Проверь группу в профиле или попроси старосту настроить бота в учебном чате.');
      return;
    }
    saveSession(ctx, { noticeChats: configured });
    await ctx.reply('Что передать старосте?', { attachments: [Keyboard.inlineKeyboard([[
      Keyboard.button.callback('Опоздаю', 'notice:type:late'),
      Keyboard.button.callback('Не приду', 'notice:type:absent'),
    ]])] });
  };

  bot.api.setMyCommands([
    { name: 'start', description: 'Открыть главное меню' },
    { name: 'schedule', description: 'Показать расписание' },
    { name: 'homework', description: 'Посмотреть домашнее задание' },
    { name: 'homework_create', description: 'Добавить домашнее задание' },
    { name: 'absence', description: 'Сообщить старосте' },
    { name: 'setup', description: 'Настроить учебную группу' },
    { name: 'headman', description: 'Назначить старосту' },
    { name: 'editor', description: 'Назначить редактора ДЗ' },
    { name: 'homework_access', description: 'Настроить доступ к ДЗ' },
    { name: 'profile', description: 'Открыть профиль' },
  ]).catch(console.error);
  bot.command('start', async (ctx) => { await restoreProfile(ctx); await replyMenu(ctx, miniAppUrl); });
  bot.command('schedule', async (ctx) => {
    if (isGroupChat(ctx)) await showGroupSchedule(ctx);
    else { await restoreProfile(ctx); await showSchedule(ctx, service); }
  });
  bot.command('homework', homeworkForContext);
  bot.command('homework_create', beginHomework);
  bot.command('absence', beginNotice);
  bot.command('setup', beginGroupSetup);
  bot.command('headman', async (ctx) => {
    if (!isGroupChat(ctx) || !await requireChatManager(ctx)) return;
    const target = ctx.message?.link?.type === 'reply' ? ctx.message.link.sender : ctx.message?.sender;
    if (!target || target.is_bot) return ctx.reply('Ответь командой /headman на сообщение человека, которого нужно назначить старостой.');
    const config = await groupConfigFor(ctx);
    if (!config?.group) return ctx.reply('Сначала привяжи чат к учебной группе командой /setup.');
    await community.setChat(ctx.chatId, {
      headman: { userId: target.user_id, name: displayName(target), username: target.username ?? null },
    });
    await ctx.reply(`Староста группы — **${displayName(target)}**. Чтобы получать личные обращения, ему нужно один раз открыть бота и нажать «Начать».`, { format: 'markdown' });
  });
  bot.command('editor', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const config = await groupConfigFor(ctx);
    if (!config?.headman || userId(ctx) !== config.headman.userId) {
      await ctx.reply('Назначать редакторов ДЗ может староста.');
      return;
    }
    const target = ctx.message?.link?.type === 'reply' ? ctx.message.link.sender : null;
    if (!target || target.is_bot) return ctx.reply('Ответь командой /editor на сообщение будущего редактора ДЗ.');
    const editors = (config.editors ?? []).filter((editor) => editor.userId !== target.user_id);
    editors.push({ userId: target.user_id, name: displayName(target), username: target.username ?? null });
    await community.setChat(ctx.chatId, { editors });
    await ctx.reply(`${displayName(target)} теперь может добавлять домашние задания.`);
  });
  bot.command('homework_access', async (ctx) => {
    if (!isGroupChat(ctx)) return;
    const config = await groupConfigFor(ctx);
    if (!config?.headman || userId(ctx) !== config.headman.userId) {
      await ctx.reply('Настраивать доступ к ДЗ может староста.');
      return;
    }
    await ctx.reply('Кто может добавлять домашние задания?', { attachments: [Keyboard.inlineKeyboard([[
      Keyboard.button.callback('Староста и редакторы', 'homework-access:editors'),
      Keyboard.button.callback('Все участники', 'homework-access:all'),
    ]])] });
  });
  bot.command('profile', (ctx) => showProfile(ctx, preferences));
  bot.on('bot_started', async (ctx) => { await restoreProfile(ctx); await replyMenu(ctx, miniAppUrl); });
  bot.on('bot_added', async (ctx) => {
    if (ctx.update.is_channel) return;
    await ctx.reply([
      '**norfly в учебной группе**', '',
      'Я свяжу этот чат с расписанием ИРНИТУ, домашними заданиями и личными обращениями к старосте.', '',
      'Сделайте меня администратором с правом чтения сообщений, затем владелец или администратор чата сможет начать настройку.',
    ].join('\n'), { format: 'markdown', attachments: [setupKeyboard()] });
  });
  bot.on('bot_removed', (ctx) => community.removeChat(ctx.chatId));

  bot.action('noop', (ctx) => ctx.answerOnCallback({ notification: 'Выбери вариант из списка' }));
  bot.action('group-setup:start', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Настройка группы' });
    await beginGroupSetup(ctx);
  });
  for (const mode of ['today', 'tomorrow', 'week']) {
    bot.action(`group-schedule:${mode}`, async (ctx) => {
      await ctx.answerOnCallback({ notification: 'Загружаю расписание' });
      await showGroupSchedule(ctx, mode);
    });
  }
  bot.action('group-homework:list', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Домашнее задание' });
    await homeworkForContext(ctx);
  });
  bot.action('group-homework:create', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Добавление ДЗ' });
    await beginHomework(ctx);
  });
  bot.action('menu:main', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Главное меню' });
    await replyMenu(ctx, miniAppUrl);
  });
  bot.action('menu:mine', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Открываю' });
    const profile = await preferences.get(userId(ctx));
    if (profile.selection?.kind === 'group') {
      saveSession(ctx, {
        selection: profile.selection,
        subgroup: profile.subgroup,
        institute: profile.institute,
        course: profile.course,
      });
      await showSchedule(ctx, service);
    }
    else await beginStudentSetup(ctx, service);
  });
  bot.action('profile:view', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Профиль' });
    await showProfile(ctx, preferences);
  });
  bot.action('profile:change', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Настройка профиля' });
    await beginStudentSetup(ctx, service);
  });
  bot.action('profile:toggle-reminders', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Настройка изменена' });
    const saved = await preferences.get(userId(ctx));
    await preferences.set(userId(ctx), {
      ...saved,
      remindersEnabled: saved.remindersEnabled === false,
    });
    await showProfile(ctx, preferences);
  });
  for (const kind of ['group', 'teacher', 'auditory']) {
    bot.action(`menu:${kind}`, async (ctx) => {
      await ctx.answerOnCallback({ notification: 'Поиск' });
      await beginSearch(ctx, kind);
    });
  }

  bot.action(/page:(institute|course|studentGroup|result):(\d+)/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Следующая страница' });
    await renderPicker(ctx, ctx.match[1], Number(ctx.match[2]));
  });
  bot.action('back:institute', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Главное меню' });
    await replyMenu(ctx, miniAppUrl);
  });
  bot.action('back:course', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Выбор института' });
    const session = saveSession(ctx, {
      step: 'institute',
      candidates: sessionFor(ctx).institutes ?? [],
    });
    if (!session.candidates.length) return beginStudentSetup(ctx, service);
    await renderPicker(ctx, 'institute');
  });
  bot.action('back:studentGroup', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Выбор курса' });
    saveSession(ctx, { step: 'course', candidates: sessionFor(ctx).courses ?? [] });
    await renderPicker(ctx, 'course');
  });
  bot.action('back:result', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Главное меню' });
    await replyMenu(ctx, miniAppUrl);
  });
  bot.action(/pick:institute:(\d+)/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Институт выбран' });
    const institute = sessionFor(ctx).candidates?.[Number(ctx.match[1])];
    if (!institute) return beginStudentSetup(ctx, service);
    const groups = await service.searchGroups('', { institute, limit: 2_000 });
    const courses = [...new Set(groups.map((group) => group.course).filter(Boolean))].sort();
    saveSession(ctx, { step: 'course', institute, groups, courses, candidates: courses });
    await renderPicker(ctx, 'course');
  });
  bot.action(/pick:course:(\d+)/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Курс выбран' });
    const session = sessionFor(ctx);
    const course = session.candidates?.[Number(ctx.match[1])];
    const groups = session.groups?.filter((group) => group.course === course) ?? [];
    saveSession(ctx, { step: 'studentGroup', course, candidates: groups });
    await renderPicker(ctx, 'studentGroup');
  });
  bot.action(/pick:studentGroup:(\d+)/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Группа выбрана' });
    const session = sessionFor(ctx);
    const group = session.candidates?.[Number(ctx.match[1])];
    if (!group) return beginStudentSetup(ctx, service);
    const selection = { kind: 'group', id: group.id, title: group.title };
    saveSession(ctx, { selection, step: 'subgroup' });
    if (!session.groupSetup) {
      await persistProfile(ctx, preferences, {
        institute: session.institute, course: session.course, selection, subgroup: null,
      });
    }
    await ctx.reply(`Группа **${group.title}**. Выбери подгруппу:`, {
      format: 'markdown',
      attachments: [Keyboard.inlineKeyboard([[
        Keyboard.button.callback('Вся группа', 'subgroup:all'),
        Keyboard.button.callback('1', 'subgroup:1'),
        Keyboard.button.callback('2', 'subgroup:2'),
      ]])],
    });
  });
  bot.action(/pick:result:(\d+)/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Выбрано' });
    const session = sessionFor(ctx);
    const selected = session.candidates?.[Number(ctx.match[1])];
    if (!selected) return replyMenu(ctx, miniAppUrl);
    const selection = { kind: session.searchKind, id: selected.id, title: selected.title || selected.fullName };
    saveSession(ctx, { selection, subgroup: null, step: null, weekOffset: 0 });
    await showSchedule(ctx, service, 'week');
  });
  for (const subgroup of ['all', '1', '2']) {
    bot.action(`subgroup:${subgroup}`, async (ctx) => {
      await ctx.answerOnCallback({ notification: 'Профиль сохранён' });
      const value = subgroup === 'all' ? null : Number(subgroup);
      const session = saveSession(ctx, { subgroup: value, step: null, weekOffset: 0 });
      if (session.groupSetup) {
        const chat = await ctx.getChat();
        await community.setChat(session.groupSetup.chatId, {
          title: chat.title,
          institute: session.institute,
          course: session.course,
          group: session.selection,
          subgroup: value,
          homeworkMode: 'editors',
          configuredBy: userId(ctx),
          configuredAt: new Date().toISOString(),
        });
        saveSession(ctx, { groupSetup: null });
        await ctx.reply(`Чат привязан к группе **${session.selection.title}**. Теперь назначь старосту: ответь командой /headman на его сообщение.`, {
          format: 'markdown', attachments: [groupMenu()],
        });
      } else {
        await persistProfile(ctx, preferences, { subgroup: value });
        await showSchedule(ctx, service, 'week');
      }
    });
  }

  bot.action(/homework:lesson:(\d+)/, async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Пара выбрана' });
    const session = sessionFor(ctx);
    const lesson = session.homeworkLessons?.[Number(ctx.match[1])];
    if (!lesson || session.homeworkChatId !== ctx.chatId) return ctx.reply('Выбор устарел. Начни ещё раз через /homework_create.');
    saveSession(ctx, { step: 'homework:text', homeworkLesson: lesson });
    await ctx.reply(`**${lesson.subject}**\n${formatHumanDate(lesson.date)} · ${lesson.time}\n\nОтправь домашнее задание одним следующим сообщением.`, { format: 'markdown' });
  });
  bot.action('homework:cancel', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Отменено' });
    saveSession(ctx, { step: null, homeworkLesson: null, homeworkLessons: null });
    await ctx.reply('Добавление домашнего задания отменено.');
  });
  for (const type of ['late', 'absent']) {
    bot.action(`notice:type:${type}`, async (ctx) => {
      await ctx.answerOnCallback({ notification: type === 'late' ? 'Опоздание' : 'Отсутствие' });
      saveSession(ctx, { step: 'notice:details', noticeType: type });
      await ctx.reply(type === 'late'
        ? 'Напиши причину и примерное время опоздания одним сообщением. При необходимости прикрепи фото.'
        : 'Напиши причину отсутствия одним сообщением. При необходимости прикрепи фото.');
    });
  }
  for (const mode of ['editors', 'all']) {
    bot.action(`homework-access:${mode}`, async (ctx) => {
      const config = await groupConfigFor(ctx);
      if (!config?.headman || userId(ctx) !== config.headman.userId) {
        await ctx.answerOnCallback({ notification: 'Доступно только старосте' });
        return;
      }
      await community.setChat(ctx.chatId, { homeworkMode: mode });
      await ctx.answerOnCallback({ notification: 'Настройка сохранена' });
      await ctx.reply(mode === 'all'
        ? 'Теперь добавлять ДЗ могут все участники чата.'
        : 'Теперь добавлять ДЗ могут староста и назначенные редакторы.');
    });
  }

  for (const mode of ['today', 'tomorrow', 'week']) {
    bot.action(`schedule:${mode}`, async (ctx) => {
      await ctx.answerOnCallback({ notification: 'Загружаю' });
      if (mode === 'week') saveSession(ctx, { weekOffset: 0 });
      await showSchedule(ctx, service, mode);
    });
  }
  bot.action('week:previous', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Предыдущая неделя' });
    saveSession(ctx, { weekOffset: (sessionFor(ctx).weekOffset ?? 0) - 1 });
    await showSchedule(ctx, service, 'week');
  });
  bot.action('week:current', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Текущая неделя' });
    saveSession(ctx, { weekOffset: 0 });
    await showSchedule(ctx, service, 'week');
  });
  bot.action('week:next', async (ctx) => {
    await ctx.answerOnCallback({ notification: 'Следующая неделя' });
    saveSession(ctx, { weekOffset: (sessionFor(ctx).weekOffset ?? 0) + 1 });
    await showSchedule(ctx, service, 'week');
  });

  bot.on('message_created', async (ctx) => {
    const text = ctx.message?.body?.text?.trim();
    if (text?.startsWith('/')) return;
    const session = sessionFor(ctx);
    if (session.step === 'homework:text') {
      if (!text) return ctx.reply('Домашнее задание нужно отправить текстом.');
      const config = await groupConfigFor(ctx);
      if (!config?.group || !await canEditHomework(ctx, config)) {
        saveSession(ctx, { step: null });
        return ctx.reply('Не удалось сохранить ДЗ: права или настройка группы изменились.');
      }
      const lesson = session.homeworkLesson;
      await community.addHomework({
        chatId: ctx.chatId,
        groupId: config.group.id,
        groupTitle: config.group.title,
        lessonDate: lesson.date,
        lessonTime: lesson.time,
        subject: lesson.subject,
        text,
        authorId: userId(ctx),
        authorName: displayName(ctx.message.sender),
      });
      saveSession(ctx, { step: null, homeworkLesson: null, homeworkLessons: null });
      await ctx.reply(`ДЗ по предмету **${lesson.subject}** сохранено.`, { format: 'markdown' });
      return;
    }
    if (session.step === 'notice:details') {
      const images = (ctx.message?.body?.attachments ?? []).filter((attachment) => attachment.type === 'image');
      if (!text) return ctx.reply('Добавь к фото короткое описание причины.');
      const chat = session.noticeChats?.[0];
      if (!chat?.headman?.userId) {
        saveSession(ctx, { step: null });
        return ctx.reply('Староста для этой группы больше не настроен.');
      }
      const kind = session.noticeType === 'late' ? 'Опоздание' : 'Отсутствие';
      const message = [
        `**${kind} · ${chat.group.title}**`, '',
        text,
        '',
        '_Обращение отправлено через анонимную форму norfly._',
      ].join('\n');
      const attachments = images.map((image) => ({ type: 'image', payload: { token: image.payload.token } }));
      try {
        await bot.api.sendMessageToUser(chat.headman.userId, message, { format: 'markdown', attachments });
        await community.addNotice({
          chatId: chat.chatId, groupId: chat.group.id, senderId: userId(ctx),
          type: session.noticeType, text, imageCount: images.length,
        });
        await ctx.reply('Сообщение отправлено старосте. Твоё имя в сообщении не указано.');
      } catch (error) {
        await community.addNotice({
          chatId: chat.chatId, groupId: chat.group.id, senderId: userId(ctx),
          type: session.noticeType, text, imageCount: images.length, status: 'pending',
        });
        await ctx.reply('Сохранил обращение, но староста ещё не открыл личный чат с ботом. Попроси его один раз нажать «Начать».');
      }
      saveSession(ctx, { step: null, noticeType: null, noticeChats: null });
      return;
    }
    if (!text) return;
    if (!session.step?.startsWith('search:')) {
      if (!isGroupChat(ctx)) await ctx.reply('Используй кнопки меню — так быстрее и удобнее.');
      return;
    }
    const kind = session.step.split(':')[1];
    const method = { group: 'searchGroups', teacher: 'searchTeachers', auditory: 'searchAuditories' }[kind];
    const candidates = await service[method](text, { limit: 40 });
    if (!candidates.length) {
      await ctx.reply(formatSearchResults('Результаты:', [], text));
      return;
    }
    saveSession(ctx, { step: 'result', searchKind: kind, candidates });
    await renderPicker(ctx, 'result');
  });

  bot.catch(async (error, ctx) => {
    console.error('Bot update failed:', error);
    try { await ctx.reply('Не удалось выполнить действие. Попробуй ещё раз.'); } catch {}
  });
  return bot;
};
