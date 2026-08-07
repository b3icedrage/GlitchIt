// GlitchIt — zero-dependency static file server for the managed preview & hosting.
// The preview/hosting images are Node-only, so the dev command must not rely on
// python3. Run with: node server.js   (PORT env var defaults to 4173)
//
// Caching layer: every response gets Cache-Control + ETag (304 revalidation)
// and text assets are served gzip-compressed. HTML and sw.js are always
// revalidated so deploys propagate instantly; the rest may be cached for a day
// (assets are versioned with ?v= query bumps).
//
// Rate limiting layer: a per-IP throttle (slow sliding window + fast burst
// window) protects the server from flooding, scraping loops, and hot-loops.
// Exceeding either budget returns HTTP 429 with a Retry-After header. Limits
// are generous for normal browsing (a full page load is ~6 requests) while
// still stopping abuse.
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

// ---------------- Rate limiting (per-IP sliding window + burst) ----------------
// Each IP keeps two counters: a slow window (windowMs -> max requests) and a
// fast burst window (burstWindowMs -> burstMax requests). Whichever trips first
// returns a 429. Stale buckets are swept on an unref'd interval so the limiter
// never grows without bound and never keeps the process alive on its own.
const RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // 300 requests / minute / IP
  burstWindowMs: 3000, // 3 seconds
  burstMax: 40,        // 40 requests / 3 seconds / IP
};

function createRateLimiter(options) {
  const cfg = Object.assign({}, RATE_LIMIT, options || {});
  const buckets = new Map(); // ip -> { count, start, burstCount, burstStart }

  const sweep = () => {
    const now = Date.now();
    for (const [ip, b] of buckets) {
      if (now - b.start > cfg.windowMs && now - b.burstStart > cfg.burstWindowMs) {
        buckets.delete(ip);
      }
    }
  };
  const timer = setInterval(sweep, Math.min(cfg.windowMs, 30 * 1000));
  if (timer.unref) timer.unref();

  return function check(ip) {
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b) {
      b = { count: 0, start: now, burstCount: 0, burstStart: now };
      buckets.set(ip, b);
    }
    if (now - b.start >= cfg.windowMs) { b.count = 0; b.start = now; }
    if (now - b.burstStart >= cfg.burstWindowMs) { b.burstCount = 0; b.burstStart = now; }
    b.count += 1;
    b.burstCount += 1;
    if (b.count > cfg.max || b.burstCount > cfg.burstMax) {
      const resetMs = Math.max(b.start + cfg.windowMs - now, b.burstStart + cfg.burstWindowMs - now, 1000);
      return { limited: true, retryAfter: Math.ceil(resetMs / 1000), remaining: 0 };
    }
    return { limited: false, retryAfter: 0, remaining: Math.max(0, cfg.max - b.count) };
  };
}

// Real client IP: prefer the left-most X-Forwarded-For entry when a proxy in
// front sets it (preview/hosting do); fall back to the socket address.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}

const rateLimit = createRateLimiter();

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
  // Rate limit before doing any work — abusive traffic gets a fast 429.
  const verdict = rateLimit(clientIp(req));
  if (verdict.limited) {
    res.writeHead(429, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(verdict.retryAfter),
      'X-RateLimit-Limit': String(RATE_LIMIT.max),
      'X-RateLimit-Remaining': '0',
    });
    res.end(`429 Too Many Requests — slow down and retry in ${verdict.retryAfter}s`);
    return;
  }

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

// Exported for tests; the server only listens when run directly (node server.js).
module.exports = { createRateLimiter, RATE_LIMIT };

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`GlitchIt preview running at http://0.0.0.0:${PORT}`);
  });
}
