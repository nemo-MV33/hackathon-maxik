import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { serveStatic } from '../src/http/static.js';

const fakeResponse = () => {
  const result = { status: 0, headers: {}, body: Buffer.alloc(0) };
  return {
    result,
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { if (body) result.body = Buffer.from(body); },
  };
};

const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'norfly-static-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'intro.mp4'), Buffer.from('0123456789'));
  await writeFile(join(root, 'index.html'), '<!doctype html>');
  return root;
};

test('видео отдаётся целиком с типом video/mp4 и поддержкой Range', async () => {
  const root = await makeRoot();
  const response = fakeResponse();
  assert.equal(await serveStatic(root, '/assets/intro.mp4', response), true);
  assert.equal(response.result.status, 200);
  assert.equal(response.result.headers['Content-Type'], 'video/mp4');
  assert.equal(response.result.headers['Accept-Ranges'], 'bytes');
  assert.equal(response.result.body.toString(), '0123456789');
});

test('запрос части файла получает 206 и нужные байты', async () => {
  const root = await makeRoot();
  const response = fakeResponse();
  await serveStatic(root, '/assets/intro.mp4', response, 'bytes=2-5');
  assert.equal(response.result.status, 206);
  assert.equal(response.result.headers['Content-Range'], 'bytes 2-5/10');
  assert.equal(response.result.headers['Content-Length'], 4);
  assert.equal(response.result.body.toString(), '2345');

  const tail = fakeResponse();
  await serveStatic(root, '/assets/intro.mp4', tail, 'bytes=-3');
  assert.equal(tail.result.body.toString(), '789');

  const open = fakeResponse();
  await serveStatic(root, '/assets/intro.mp4', open, 'bytes=0-');
  assert.equal(open.result.status, 206);
  assert.equal(open.result.body.toString(), '0123456789');
});

test('диапазон за концом файла получает 416', async () => {
  const root = await makeRoot();
  const response = fakeResponse();
  await serveStatic(root, '/assets/intro.mp4', response, 'bytes=50-60');
  assert.equal(response.result.status, 416);
  assert.equal(response.result.headers['Content-Range'], 'bytes */10');
});
