// GlitchIt — zero-dependency static file server for the managed preview & hosting.
// The preview/hosting images are Node-only, so the dev command must not rely on
// python3. Run with: node server.js   (PORT env var defaults to 4173)
//
// Caching layer: every response gets Cache-Control + ETag (304 revalidation)
// and text assets are served gzip-compressed. HTML and sw.js are always
// revalidated so deploys propagate instantly; the rest may be cached for a day
// (assets are versioned with ?v= query bumps).
'use strict';

const http = require('node:http');
const zlib = require('node:zlib');
const { readFile, stat } = require('node:fs/promises');
const { join, normalize, extname, resolve, sep, basename } = require('node:path');

const ROOT = resolve(__dirname);
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Text-ish extensions worth gzip-compressing.
const COMPRESSIBLE_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);

// Gzip cache: key = `${mtimeMs}:${path}` so any edit invalidates automatically.
const gzipCache = new Map();
const GZIP_CACHE_MAX = 64;

function gzipFor(filePath, mtimeMs, data) {
  const key = `${mtimeMs}:${filePath}`;
  let gz = gzipCache.get(key);
  if (!gz) {
    gz = zlib.gzipSync(data);
    gzipCache.set(key, gz);
    if (gzipCache.size > GZIP_CACHE_MAX) {
      gzipCache.delete(gzipCache.keys().next().value);
    }
  }
  return gz;
}

// Map a request path to a file inside ROOT — never outside it.
async function resolvePath(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch (err) {
    return null;
  }
  if (rel === '' || rel === '/') rel = '/index.html';
  const target = normalize(resolve(ROOT, '.' + rel));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  try {
    const s = await stat(target);
    if (s.isDirectory()) {
      const idx = join(target, 'index.html');
      try {
        await stat(idx);
        return idx;
      } catch (err) {
        return null;
      }
    }
    return target;
  } catch (err) {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const file = await resolvePath(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('404 Not Found');
    return;
  }
  try {
    const s = await stat(file);
    const ext = extname(file).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';
    const isSw = basename(file) === 'sw.js';
    // HTML + the service worker always revalidate; everything else is cacheable.
    const cacheControl = (isHtml || isSw) ? 'public, no-cache' : 'public, max-age=86400';
    const etag = `W/"${s.size}-${Math.round(s.mtimeMs)}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
      res.end();
      return;
    }

    const data = await readFile(file);
    const acceptsGzip = /gzip/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE_EXT.has(ext)) {
      const gz = gzipFor(file, s.mtimeMs, data);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Encoding': 'gzip',
        'Cache-Control': cacheControl,
        ETag: etag,
        Vary: 'Accept-Encoding',
      });
      res.end(gz);
    } else {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cacheControl, ETag: etag });
      res.end(data);
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GlitchIt preview running at http://0.0.0.0:${PORT}`);
});
