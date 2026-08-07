// GlitchIt — zero-dependency static file server for the managed preview.
// The preview/hosting images are Node-only, so the dev command must not rely
// on python3. Run with: node server.js   (PORT env var defaults to 4173)
'use strict';

const http = require('node:http');
const { readFile, stat } = require('node:fs/promises');
const { join, normalize, extname, resolve, sep } = require('node:path');

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
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GlitchIt preview running at http://0.0.0.0:${PORT}`);
});
