import { Bot } from '@maxhub/max-bot-api';

const maxApiUrl = process.env.MAX_API_URL?.trim() || 'https://platform-api2.max.ru';

export const alertAdministrator = async ({ token, adminId, text, send }) => {
  if (!token || !/^[1-9]\d*$/.test(String(adminId ?? ''))) throw new Error('backup_alert_not_configured');
  const deliver = send ?? ((id, message) => new Bot(token, { clientOptions: { baseUrl: maxApiUrl } }).api.sendMessageToUser(id, message));
  await deliver(Number(adminId), text);
};
