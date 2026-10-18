import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { spawn } from 'node:child_process';
const MAGIC = Buffer.from('NORFLY01');
const keyBytes = (key) => { if (!/^[a-f0-9]{64}$/i.test(key ?? '')) throw new Error('backup_key_requires_32_bytes_hex'); return Buffer.from(key, 'hex'); };

export const inventory = async (root) => {
  const files = [];
  const counts = {};
  const walk = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('backup_unsupported_file');
      if (info.isDirectory()) { await walk(path); continue; }
      const file = relative(root, path).split('\\').join('/');
      if (file === 'manifest.json') continue;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      files.push({ path: file, size: info.size, sha256: hash.digest('hex') });
      if (name.endsWith('.json')) {
        const value = JSON.parse(await readFile(path, 'utf8'));
        counts[file] = Array.isArray(value) ? value.length : Object.fromEntries(Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object').map(([key, entry]) => [key, Object.keys(entry).length]));
      }
    }
  };
  await walk(root);
  return { files, counts };
};

export const encryptArchive = async (root, destination, key) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  cipher.setAAD(MAGIC);
  await writeFile(destination, Buffer.concat([MAGIC, nonce]), { mode: 0o600, flag: 'wx' });
  const tar = spawn('tar', ['-czf', '-', '-C', root, '.'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COPYFILE_DISABLE: '1' } });
  let errorText = '';
  tar.stderr.on('data', (chunk) => { errorText += chunk; });
  const finished = new Promise((done, reject) => { tar.on('error', reject); tar.on('close', (code) => code === 0 ? done() : reject(new Error(`backup_tar_failed: ${errorText.slice(0, 100)}`))); });
  await Promise.all([pipeline(tar.stdout, cipher, createWriteStream(destination, { flags: 'a' })), finished]);
  await writeFile(destination, cipher.getAuthTag(), { flag: 'a' });
};

const decrypted = async (source, key) => {
  const { open } = await import('node:fs/promises');
  const input = await open(source, 'r');
  let header, tag, size;
  try {
    size = (await input.stat()).size;
    if (size < 36) throw new Error('backup_invalid_format');
    header = Buffer.alloc(20); tag = Buffer.alloc(16);
    await input.read(header, 0, 20, 0); await input.read(tag, 0, 16, size - 16);
  } finally { await input.close(); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('backup_invalid_format');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), header.subarray(8));
  decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
  return Readable.from((async function* () {
    for await (const chunk of createReadStream(source, { start: 20, end: size - 17 })) yield decipher.update(chunk);
    yield decipher.final();
  })());
};
const canonical = (value) => JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
const textField = (buffer) => buffer.toString('utf8').replace(/\0.*$/s, '');

// Streaming tar verifier: no second archive or extracted attachment tree on the VM disk.
export const verifyArchive = async (source, key) => {
  const start = performance.now();
  const input = await decrypted(source, key);
  const gunzip = createGunzip();
  const pumping = pipeline(input, gunzip);
  const files = []; const counts = {}; let manifest;
  let pending = Buffer.alloc(0); let entry; let padding = 0; let longName; let paxPath; let ended = false;
  const finish = () => {
    if (entry.type === 'L') longName = textField(Buffer.concat(entry.parts)).replace(/\n$/, '');
    else if (entry.type === 'x' || entry.type === 'g') {
      const pax = Buffer.concat(entry.parts); let offset = 0;
      while (offset < pax.length) {
        const space = pax.indexOf(32, offset); const length = Number(pax.subarray(offset, space).toString());
        if (!Number.isInteger(length) || length <= 0 || offset + length > pax.length) throw new Error('backup_invalid_pax');
        const field = pax.subarray(space + 1, offset + length - 1).toString('utf8');
        if (field.startsWith('path=')) paxPath = field.slice(5);
        offset += length;
      }
    } else if (entry.type === '0' || entry.type === '\0') {
      const record = { path: entry.name, size: entry.size, sha256: entry.hash.digest('hex') };
      if (entry.name === 'manifest.json') manifest = JSON.parse(Buffer.concat(entry.parts).toString());
      else {
        if (files.some((file) => file.path === entry.name)) throw new Error('backup_duplicate_path');
        files.push(record);
        if (entry.name.endsWith('.json')) {
          const value = JSON.parse(Buffer.concat(entry.parts).toString());
          counts[entry.name] = Array.isArray(value) ? value.length : Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object').map(([name, item]) => [name, Object.keys(item).length]));
        }
      }
    }
    entry = undefined;
  };
  try {
    for await (const chunk of gunzip) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length) {
        if (padding) { const size = Math.min(padding, pending.length); pending = pending.subarray(size); padding -= size; continue; }
        if (entry) {
          const size = Math.min(entry.remaining, pending.length); const bytes = pending.subarray(0, size);
          entry.hash.update(bytes); if (entry.collect) entry.parts.push(bytes);
          entry.remaining -= size; pending = pending.subarray(size);
          if (!entry.remaining) { padding = (512 - entry.size % 512) % 512; finish(); }
          continue;
        }
        if (pending.length < 512) break;
        const header = pending.subarray(0, 512); pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) { ended = true; continue; }
        if (ended) throw new Error('backup_invalid_tar');
        const expected = parseInt(textField(header.subarray(148, 156)).trim(), 8);
        let sum = 0; for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : header[index];
        if (sum !== expected) throw new Error('backup_invalid_tar_checksum');
        const type = String.fromCharCode(header[156]);
        let name = textField(header.subarray(0, 100)); const prefix = textField(header.subarray(345, 500));
        if (prefix) name = `${prefix}/${name}`;
        if (!['x', 'g', 'L'].includes(type)) { name = paxPath || longName || name; paxPath = undefined; longName = undefined; }
        name = name.replace(/^\.\//, '');
        if (name.startsWith('/') || name.split('/').includes('..') || !['0', '\0', '5', 'x', 'g', 'L'].includes(type)) throw new Error('backup_unsafe_entry');
        const size = parseInt(textField(header.subarray(124, 136)).trim() || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('backup_invalid_tar_size');
        const collect = ['x', 'g', 'L'].includes(type) || name === 'manifest.json' || name.endsWith('.json');
        if (collect && size > 64 * 1024 * 1024) throw new Error('backup_json_too_large');
        entry = { name, type, size, remaining: size, hash: createHash('sha256'), parts: [], collect };
        if (!size) finish();
      }
    }
    await pumping;
  } catch (error) { gunzip.destroy(); input.destroy(); await pumping.catch(() => {}); throw error; }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const expectedFiles = [...(manifest?.inventory?.files ?? [])].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (!ended || entry || !manifest || manifest.format !== 1 || canonical({ files, counts }) !== canonical({ files: expectedFiles, counts: manifest.inventory.counts })) throw new Error('backup_verification_failed');
  return { verified: true, durationMs: Math.round(performance.now() - start), snapshotAt: manifest.snapshotAt, files: files.length, counts };
};

export const restoreArchive = async (source, destination, key) => {
  const start = performance.now();
  const result = await verifyArchive(source, key);
  if ((await readdir(destination).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))).length) throw new Error('restore_destination_not_empty');
  const parent = dirname(resolve(destination)); await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(join(parent, '.norfly-restore-'));
  try {
    const input = await decrypted(source, key);
    const tar = spawn('tar', ['-xzf', '-', '-C', workspace], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errorText = ''; tar.stderr.on('data', (chunk) => { errorText += chunk; });
    const finished = new Promise((done, reject) => { tar.on('error', reject); tar.on('close', (code) => code === 0 ? done() : reject(new Error(`restore_tar_failed: ${errorText.slice(0, 100)}`))); });
    await Promise.all([pipeline(input, tar.stdin), finished]);
    // Verify bytes actually written, as well as the downloaded archive.
    const actual = await inventory(workspace); const manifest = JSON.parse(await readFile(join(workspace, 'manifest.json'), 'utf8'));
    if (canonical(actual) !== canonical(manifest.inventory)) throw new Error('backup_verification_failed');
    await rm(destination, { recursive: true, force: true });
    const { rename } = await import('node:fs/promises'); await rename(workspace, destination);
    return { ...result, durationMs: Math.round(performance.now() - start) };
  } finally { await rm(workspace, { recursive: true, force: true }); }
};
