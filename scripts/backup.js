import { alertAdministrator } from '../src/backup/alert.js';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { ObjectStorage } from '../src/backup/object-storage.js';
import { backup, restoreLatest, prepareBackup, writeBackupStatus } from '../src/backup/service.js';

const notify = (text) => alertAdministrator({ token: process.env.BOT_TOKEN, adminId: process.env.BACKUP_ADMIN_ID, text });
const run = async () => {
  if (process.argv[2] === 'alert') {
    await writeBackupStatus(process.env.BACKUP_STATUS_FILE || '/backup/last-backup.json', { ok: false, failedAt: new Date().toISOString(), error: 'backup_job_failed' });
    return notify('norfly: резервная копия завершилась ошибкой. Проверьте журнал norfly-backup и время последней успешной копии.');
  }
  const key = (await readFile(process.env.BACKUP_KEY_FILE, 'utf8')).trim();
  if (process.argv[2] === 'snapshot') {
    const prepared = await prepareBackup({ root: '/snapshot', archive: '/work/backup.enc', manifestPath: '/work/manifest.json', key });
    const { writeFile } = await import('node:fs/promises');
    await writeFile('/work/prepared.json', JSON.stringify(prepared), { mode: 0o600 }); return;
  }
  const storage = new ObjectStorage({ bucket: process.env.BACKUP_BUCKET, accessKeyId: process.env.BACKUP_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_SECRET_ACCESS_KEY });
  const common = { storage, key, prefix: process.env.BACKUP_PREFIX || 'norfly/' };
  if (process.argv[2] === 'restore') {
    if (!process.argv[3]) throw new Error('restore_destination_required');
    console.log(JSON.stringify(await restoreLatest({ ...common, destination: process.argv[3] }), null, 2)); return;
  }
  const prepared = JSON.parse(await readFile('/work/prepared.json', 'utf8'));
  await backup({ ...common, prepared, daily: Number(process.env.BACKUP_KEEP_DAILY || 14), weekly: Number(process.env.BACKUP_KEEP_WEEKLY || 8),
    statusPath: process.env.BACKUP_STATUS_FILE || '/backup/last-backup.json',
  });
};
try { await run(); } catch (error) { console.error('Backup failed:', error.message); process.exitCode = 1; }
