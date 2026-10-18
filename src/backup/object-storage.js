import { createHash, createHmac } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const escape = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const xml = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// S3 Signature V4. No credentials or signed request headers are logged.
export class ObjectStorage {
  constructor({ bucket, accessKeyId, secretAccessKey, endpoint = 'https://storage.yandexcloud.net', region = 'ru-central1', fetchImpl = fetch }) {
    if (!/^[a-z0-9][a-z0-9.-]+$/.test(bucket ?? '') || !accessKeyId || !secretAccessKey) throw new Error('backup_storage_not_configured');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') throw new Error('backup_requires_https');
    Object.assign(this, { bucket, accessKeyId, secretAccessKey, endpoint: url.origin, region, fetchImpl });
  }

  async request(method, key = '', { query = {}, file, bytes } = {}) {
    const path = `/${this.bucket}/${key.split('/').map(escape).join('/')}`;
    const search = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${escape(name)}=${escape(value)}`).join('&');
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    let digest = hash(bytes ?? '');
    if (file) { const sum = createHash('sha256'); for await (const chunk of createReadStream(file)) sum.update(chunk); digest = sum.digest('hex'); }
    const host = new URL(this.endpoint).host;
    const signed = 'host;x-amz-content-sha256;x-amz-date';
    const headers = { host, 'x-amz-content-sha256': digest, 'x-amz-date': date };
    if (file) headers['content-length'] = String((await stat(file)).size);
    else if (bytes) headers['content-length'] = String(bytes.length);
    const canonical = [method, path, search, `host:${host}\nx-amz-content-sha256:${digest}\nx-amz-date:${date}\n`, signed, digest].join('\n');
    const scope = `${date.slice(0, 8)}/${this.region}/s3/aws4_request`;
    const signing = hmac(hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, date.slice(0, 8)), this.region), 's3'), 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${hmac(signing, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString('hex')}`;
    const response = await this.fetchImpl(`${this.endpoint}${path}?${search}`, {
      method, headers, ...(file ? { body: createReadStream(file), duplex: 'half' } : bytes ? { body: bytes } : {}), signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok) throw new Error(`backup_storage_http_${response.status}`);
    return response;
  }
  async put(key, file) {
    if ((await stat(file)).size <= 64 * 1024 * 1024) { await this.request('PUT', key, { file }); return; }
    await this.multipart(key, file);
  }
  async multipart(key, file, partBytes = 64 * 1024 * 1024) {
    const started = await this.request('POST', key, { query: { uploads: '' } });
    const uploadId = (await started.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    if (!uploadId) throw new Error('backup_storage_invalid_upload');
    const id = xml(uploadId); const parts = []; const input = await open(file, 'r');
    try {
      const size = (await input.stat()).size;
      for (let offset = 0, number = 1; offset < size; offset += partBytes, number += 1) {
        const bytes = Buffer.alloc(Math.min(partBytes, size - offset)); let filled = 0;
        while (filled < bytes.length) {
          const read = await input.read(bytes, filled, bytes.length - filled, offset + filled);
          if (!read.bytesRead) throw new Error('backup_source_changed'); filled += read.bytesRead;
        }
        const response = await this.request('PUT', key, { query: { partNumber: String(number), uploadId: id }, bytes });
        const etag = response.headers.get('etag');
        if (!etag || !/^"?[a-f0-9-]+"?$/i.test(etag)) throw new Error('backup_storage_invalid_etag');
        parts.push(`<Part><PartNumber>${number}</PartNumber><ETag>${etag}</ETag></Part>`);
      }
      const response = await this.request('POST', key, { query: { uploadId: id }, bytes: Buffer.from(`<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>`) });
      if (/<Error>/.test(await response.text())) throw new Error('backup_storage_complete_failed');
    } catch (error) {
      await this.request('DELETE', key, { query: { uploadId: id } }).catch(() => {}); throw error;
    } finally { await input.close(); }
  }
  async get(key, file) {
    const response = await this.request('GET', key);
    const { pipeline } = await import('node:stream/promises');
    const { createWriteStream } = await import('node:fs');
    await pipeline(response.body, createWriteStream(file, { mode: 0o600, flags: 'wx' }));
  }
  async delete(key) { await this.request('DELETE', key); }
  async list(prefix) {
    const keys = [];
    let token;
    do {
      const response = await this.request('GET', '', { query: { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) } });
      const body = await response.text();
      keys.push(...[...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => xml(match[1])));
      token = body.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
      if (/<IsTruncated>true<\/IsTruncated>/.test(body) && !token) throw new Error('backup_storage_invalid_listing');
      if (token) token = xml(token);
    } while (token);
    return keys;
  }
}
