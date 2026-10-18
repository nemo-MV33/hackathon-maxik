import { mkdir, mkdtemp, readFile, rm, writeFile, statfs, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory, encryptArchive, restoreArchive, verifyArchive } from './archive.js';

export const retentionKeys = (keys, { daily = 14, weekly = 8 } = {}) => {
  for (const count of [daily, weekly]) if (!Number.isInteger(count) || count < 1) throw new Error('backup_invalid_retention');
  const sorted = keys.filter((key) => /\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.enc$/.test(key)).sort().reverse();
  // One recovery point per UTC calendar day and ISO week; union avoids duplicating archives.
  const keep = new Set(); const days = new Set(); const weeks = new Set();
  for (const key of sorted) {
    const date = key.split('/').at(-1).slice(0, 10);
    if (!days.has(date) && days.size < daily) { days.add(date); keep.add(key); }
    const monday = new Date(`${date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const week = monday.toISOString().slice(0, 10);
    if (!weeks.has(week) && weeks.size < weekly) { weeks.add(week); keep.add(key); }
  }
  return sorted.filter((key) => !keep.has(key));
};

export const writeBackupStatus = async (statusPath, value) => {
  console.log(JSON.stringify({ event: 'backup', ...value }));
  if (statusPath) {
    const previous = await readFile(statusPath, 'utf8').then(JSON.parse).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    value.lastSuccess = value.ok ? { key: value.key, snapshotAt: value.snapshotAt, completedAt: value.completedAt } : previous?.lastSuccess ?? null;
    await writeFile(`${statusPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(`${statusPath}.tmp`, statusPath);
  }
};

export const prepareBackup = async ({ root, archive, manifestPath, key, snapshotAt = new Date().toISOString() }) => {
  const manifest = { format: 1, snapshotAt, inventory: await inventory(root) };
  const space = await statfs(join(archive, '..'));
  const budget = manifest.inventory.files.reduce((total, file) => total + file.size, 0) * 1.02 + 512 * 1024 * 1024;
  if (space.bavail * space.bsize < budget) throw new Error('backup_disk_full');
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  await encryptArchive(root, archive, key, manifestPath);
  return { archive, manifest };
};

export const backup = async ({ storage, capture, prepared, key, prefix = 'norfly/', daily = 14, weekly = 8, statusPath, notify = async () => {}, now = () => new Date() }) => {
  const start = performance.now();
  const workspace = await mkdtemp(join(tmpdir(), 'norfly-backup-'));
  const report = (value) => writeBackupStatus(statusPath, value);
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\/$/.test(prefix)) throw new Error('backup_invalid_prefix');
    retentionKeys([], { daily, weekly });
    let archive, manifest;
    if (prepared) ({ archive, manifest } = prepared);
    else {
      const root = join(workspace, 'snapshot'); await mkdir(root, { mode: 0o700 });
      const snapshotAt = await capture(root) || now().toISOString();
      manifest = { format: 1, snapshotAt, inventory: await inventory(root) };
      await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
      archive = join(workspace, 'backup.enc'); await encryptArchive(root, archive, key);
    }
    const snapshotAt = manifest.snapshotAt;
    // Every upload must survive authenticated streaming verification before rotation.
    const name = `${prefix}${snapshotAt.replace(/[:.]/g, '-')}.enc`;
    await storage.put(name, archive);
    await rm(archive);
    const downloaded = join(workspace, 'download.enc'); await storage.get(name, downloaded);
    const verified = await verifyArchive(downloaded, key);
    for (const old of retentionKeys(await storage.list(prefix), { daily, weekly })) await storage.delete(old);
    const result = { ok: true, key: name, snapshotAt, completedAt: now().toISOString(), durationMs: Math.round(performance.now() - start), restoreMs: verified.durationMs, files: verified.files, counts: verified.counts };
    await report(result); return result;
  } catch (error) {
    await report({ ok: false, failedAt: now().toISOString(), error: error.message }).catch(console.error);
    await notify('norfly: резервная копия не выполнена. Проверьте журнал norfly-backup и последнюю успешную копию.').catch((failure) => console.error('Backup alert failed:', failure.message));
    throw error;
  } finally { await rm(workspace, { recursive: true, force: true }); }
};

export const restoreLatest = async ({ storage, prefix = 'norfly/', destination, key }) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\/$/.test(prefix)) throw new Error('backup_invalid_prefix');
  const latest = (await storage.list(prefix)).filter((name) => /\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.enc$/.test(name)).sort().at(-1);
  if (!latest) throw new Error('backup_not_found');
  const workspace = await mkdtemp(join(tmpdir(), 'norfly-download-'));
  const start = performance.now();
  try {
    const archive = join(workspace, 'backup.enc'); await storage.get(latest, archive);
    return { key: latest, ...await restoreArchive(archive, destination, key), totalDurationMs: Math.round(performance.now() - start) };
  } finally { await rm(workspace, { recursive: true, force: true }); }
};
