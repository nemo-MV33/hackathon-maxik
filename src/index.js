import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createBot } from './bot/create-bot.js';
import { createHttpServer } from './http/server.js';
import { IrnituClient } from './irnitu/client.js';
import { ScheduleService } from './services/schedule-service.js';
import { ReminderService } from './services/reminder-service.js';
import { PreferencesStore } from './storage/preferences.js';
import { CommunityStore } from './storage/community.js';

if (!config.botToken) {
  throw new Error('BOT_TOKEN is not configured');
}

const client = new IrnituClient(config.irnitu);
const service = new ScheduleService(client);
Promise.allSettled([service.groups(), service.teachers(), service.auditories()]);
const preferences = new PreferencesStore(
  fileURLToPath(new URL('../data/preferences.json', import.meta.url)),
);
const community = new CommunityStore(
  fileURLToPath(new URL('../data/community.json', import.meta.url)),
);
const bot = createBot({
  token: config.botToken,
  service,
  miniAppUrl: config.miniAppUrl,
  preferences,
  community,
});
const server = createHttpServer({ service, apiAccessKey: config.apiAccessKey });
const reminders = new ReminderService({ bot, service, preferences });

server.listen(config.port, () => {
  console.log(`HTTP API is listening on port ${config.port}`);
});
reminders.start();

const stop = async (signal) => {
  console.log(`Received ${signal}, shutting down`);
  bot.stop();
  reminders.stop();
  server.close(() => process.exit(0));
};

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

await bot.start();
