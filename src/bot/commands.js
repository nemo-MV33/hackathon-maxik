// Разбор команд: «/today», «/today@bot», «/Today аргументы», «@bot /today».
// Встроенный bot.command сравнивает строку целиком и пропускает варианты с упоминанием бота.

const COMMAND = /^\/([a-z0-9_]+)(?:@([\w.-]+))?(?:\s+([\s\S]*))?$/i;

const stripLeadingMention = (message, botId) => {
  const text = message?.body?.text ?? '';
  const mention = message?.body?.markup?.find((item) => item.type === 'user_mention' && item.from === 0);
  if (mention && (!botId || mention.user_id === botId)) return text.slice(mention.length).trim();
  return text.replace(/^@[\w.-]+\s+(?=\/)/, '').trim();
};

export const parseCommand = (message, { botId, botUsername } = {}) => {
  const text = stripLeadingMention(message, botId);
  const match = COMMAND.exec(text);
  if (!match) return null;
  const [, name, target, args = ''] = match;
  if (target && botUsername && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: name.toLowerCase(), args: args.trim() };
};
