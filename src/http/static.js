import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

export const serveStatic = async (root, pathname, response) => {
  const asset = (pathname !== '/' && await readAsset(root, pathname))
    || (!extname(pathname) && await readAsset(root, '/index.html'));
  if (!asset) return false;

  const isHashedAsset = asset.filePath.includes(`${sep}assets${sep}`);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(asset.filePath)] ?? 'application/octet-stream',
    'Content-Length': asset.data.length,
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  response.end(asset.data);
  return true;
};
