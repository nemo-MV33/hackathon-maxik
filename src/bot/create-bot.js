import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { addDays } from '../lib/date.js';
import { formatSchedule, formatSearchResults, formatWeekTitle } from './format.js';

const PAGE_SIZE = 8;
const sessions = new Map();
const userId = (ctx) => ctx.user?.user_id ?? ctx.chatId;
const sessionFor = (ctx) => sessions.get(userId(ctx)) ?? {};
const saveSession = (ctx, patch) => {
  const value = { ...sessionFor(ctx), ...patch };
  sessions.set(userId(ctx), value);
  return value;
};
const buttonText = (value) => String(value).slice(0, 54);

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

export const createBot = ({ token, service, miniAppUrl, preferences }) => {
  const bot = new Bot(token);
  const restoreProfile = async (ctx) => {
    const current = sessionFor(ctx);
    if (current.restored) return current;
    const saved = await preferences.get(userId(ctx));
    return saveSession(ctx, { ...saved, restored: true });
  };

  bot.api.setMyCommands([
    { name: 'start', description: 'Открыть главное меню' },
    { name: 'schedule', description: 'Показать расписание' },
    { name: 'profile', description: 'Открыть профиль' },
  ]).catch(console.error);
  bot.command('start', async (ctx) => { await restoreProfile(ctx); await replyMenu(ctx, miniAppUrl); });
  bot.command('schedule', async (ctx) => { await restoreProfile(ctx); await showSchedule(ctx, service); });
  bot.command('profile', (ctx) => showProfile(ctx, preferences));
  bot.on('bot_started', async (ctx) => { await restoreProfile(ctx); await replyMenu(ctx, miniAppUrl); });

  bot.action('noop', (ctx) => ctx.answerOnCallback({ notification: 'Выбери вариант из списка' }));
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
    await persistProfile(ctx, preferences, {
      institute: session.institute, course: session.course, selection, subgroup: null,
    });
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
      saveSession(ctx, { subgroup: value, step: null, weekOffset: 0 });
      await persistProfile(ctx, preferences, { subgroup: value });
      await showSchedule(ctx, service, 'week');
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
    if (!text || text.startsWith('/')) return;
    const session = sessionFor(ctx);
    if (!session.step?.startsWith('search:')) {
      await ctx.reply('Используй кнопки меню — так быстрее и удобнее.');
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
