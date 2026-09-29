import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const readAsset = async (root, pathname) => {
  const filePath = normalize(join(root, decodeURIComponent(pathname)));
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  try {
    return { filePath, data: await readFile(filePath) };
  } catch (error) {
    if (['ENOENT', 'EISDIR'].includes(error.code)) return null;
    throw error;
  }
};

// Safari и WebView на iOS проигрывают видео только частями: без ответа 206 на Range заставка не запустится.
const byteRange = (header, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : { start: size, end: size - 1 };
};

export const serveStatic = async (root, pathname, response, rangeHeader) => {
  const asset = (pathname !== '/' && await readAsset(root, pathname))
    || (!extname(pathname) && await readAsset(root, '/index.html'));
  if (!asset) return false;

  const isHashedAsset = asset.filePath.includes(`${sep}assets${sep}`);
  const headers = {
    'Content-Type': MIME_TYPES[extname(asset.filePath)] ?? 'application/octet-stream',
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Accept-Ranges': 'bytes',
  };
  const size = asset.data.length;
  const range = byteRange(rangeHeader, size);
  if (range && range.start >= size) {
    response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
    response.end();
    return true;
  }
  if (range) {
    response.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': range.end - range.start + 1,
    });
    response.end(asset.data.subarray(range.start, range.end + 1));
    return true;
  }
  response.writeHead(200, { ...headers, 'Content-Length': size });
  response.end(asset.data);
  return true;
};
