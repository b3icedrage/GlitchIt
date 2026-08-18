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

// Account registry (lists every registered user via the Supabase Admin API).
const accountsHandler = require('./api/accounts.js');
// LiveKit Cloud access-token minting (real WebRTC calls on chat.html).
const livekitTokenHandler = require('./api/livekit-token.js');
// NVIDIA video generation proxy (ai-glitch tool on the camera page).
const nvidiaVideoHandler = require('./api/nvidia-video.js');

const ROOT = resolve(__dirname);
const PORT = Number(process.env.PORT || 4173);

// Load local dev secrets from .env.local if present (e.g. NVIDIA_API_KEY).
// The platform may inject sandbox env vars, but reading the file here too
// guarantees the preview works even without injection. Values go straight
// into the process environment — they are never logged or exposed.
const { readFileSync } = require('node:fs');
function loadLocalEnv() {
  try {
    const text = readFileSync(join(ROOT, '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch (err) { /* no .env.local — fall back to platform env */ }
}
loadLocalEnv();

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

// ---------------- AI assistant (OpenAI-compatible → NVIDIA NIM) ----------------
// The chat UI (Messages + Settings → GlitchIt AI) POSTs the conversation here;
// this endpoint forwards it to NVIDIA's hosted model with the API key held
// server-side only (never shipped to the browser), and streams NDJSON lines
// back: {t:'r'} reasoning, {t:'c'} content, {t:'done'}, {t:'err'}.
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const AI_TIMEOUT_MS = 150 * 1000;
const AI_MAX_BODY = 64 * 1024;

const AI_SYSTEM_PROMPT = [
  'You are the GlitchIt AI assistant — a friendly, helpful support agent for GlitchIt,',
  'a social marketplace where creators share short glitch-style videos, photos, and',
  '"drops", and followers can shop creators\' storefronts.',
  'You help with: reporting bugs and complaints (and escalating to a real human',
  'support agent when needed), account and login issues, creating posts/videos with',
  'the in-app camera, saved videos, followers and drops, the marketplace/storefront',
  'and orders, and general product questions.',
  'Be warm and concise. Use plain language. When the user has a complaint or issue,',
  'acknowledge it, ask for the key details (what happened, what they expected), and',
  'tell them the fastest path to a fix — including that their complaint can be',
  'escalated to a human if you cannot resolve it. Never invent technical steps; if',
  'unsure, suggest contacting GlitchIt support.',
].join(' ');

function getNvidiaKey() {
  // Set via .env.local (sandbox) / freebuff-deploy env (production).
  return process.env.NVIDIA_API_KEY || '';
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    return null;
  }
}

// Streaming generator: yields {type:'reasoning'|'content'|'done'|'error', text}.
async function* chatStream(messages, opts) {
  const controller = opts && opts.signal ? opts.signal : undefined;
  let res;
  try {
    res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
        reasoning_budget: 16384,
      }),
      signal: controller,
    });
  } catch (err) {
    yield { type: 'error', text: 'Could not reach the AI service.' };
    return;
  }

  if (!res.ok || !res.body) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (err) { /* ignore */ }
    if (res.status === 401 || res.status === 403) {
      yield { type: 'error', text: 'The AI assistant is not configured correctly (invalid API key).' };
    } else if (res.status === 429) {
      yield { type: 'error', text: 'The AI assistant is busy right now — please try again in a moment.' };
    } else {
      yield { type: 'error', text: detail || `The AI service returned an error (${res.status}).` };
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch (err) { continue; }
        const choice = chunk.choices && chunk.choices[0];
        if (!choice || !choice.delta) continue;
        const delta = choice.delta;
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          yield { type: 'reasoning', text: delta.reasoning_content };
        }
        if (typeof delta.reasoning === 'string' && delta.reasoning) {
          yield { type: 'reasoning', text: delta.reasoning };
        } else if (Array.isArray(delta.reasoning)) {
          // Structured reasoning: emit only the summary, not every internal step.
          const summary = delta.reasoning.find((r) => r && r.type === 'summary' && r.text);
          if (summary) yield { type: 'reasoning', text: summary.text };
        }
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'content', text: delta.content };
        }
      }
    }
  } catch (err) {
    if (!(opts.signal && opts.signal.aborted)) {
      yield { type: 'error', text: 'The AI stream was interrupted.' };
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done' };
}

async function handleChatRequest(req, res) {
  const apiKey = getNvidiaKey();
  if (!apiKey) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'The AI assistant is not configured yet — set the NVIDIA_API_KEY environment variable and restart the server.' }));
    return;
  }

  const body = await readJsonBody(req, AI_MAX_BODY);
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'A messages[] array is required.' }));
    return;
  }

  // Bound the conversation: last 24 messages, 6k chars each.
  const messages = body.messages
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  const handle = typeof body.user === 'string' && body.user ? body.user : '';
  messages.unshift({
    role: 'system',
    content: AI_SYSTEM_PROMPT + (handle ? `\n\nThe person you are helping is @${handle}.` : ''),
  });

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  // Stop spending tokens if the client walks away mid-stream.
  req.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    for await (const line of chatStream(messages, { apiKey, signal: controller.signal })) {
      if (res.writableEnded) break;
      try {
        res.write(JSON.stringify(line) + '\n');
      } catch (err) { break; }
      if (line.type === 'error') break;
    }
  } finally {
    clearTimeout(timer);
  }
  try { res.end(); } catch (err) { /* client already gone */ }
}

// ---------------- Music search proxy (Deezer + Apple Music) ----------------
// Browsers cannot call Deezer/Apple Music directly from the app origin (the
// APIs don't send CORS headers), so the note-composer music sheet calls this
// same-origin endpoint instead; server-side fetches have no CORS restrictions.
//   GET /api/music?q=...    -> merged Deezer + iTunes search results
//   GET /api/music?chart=1  -> Deezer global top chart (Trending tab)
const MUSIC_CACHE_TTL_MS = 60 * 1000;
const MUSIC_TIMEOUT_MS = 8 * 1000;
const musicCache = new Map(); // key -> { at, tracks }

async function musicFetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MUSIC_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GlitchIt/1.0' } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function musicFromDeezer(t, source) {
  return {
    title: t.title || 'Unknown track',
    artist: (t.artist && t.artist.name) || 'Unknown artist',
    genre: source,
    url: t.preview || null,
    art: (t.album && (t.album.cover_medium || t.album.cover_small)) || '',
    source,
    duration: typeof t.duration === 'number' ? t.duration : 0,
    explicit: Boolean(t.explicit_lyrics)
  };
}

function musicFromItunes(r) {
  return {
    title: r.trackName || 'Unknown track',
    artist: r.artistName || 'Unknown artist',
    genre: r.primaryGenreName || 'Music',
    url: r.previewUrl || null,
    art: r.artworkUrl100 || '',
    source: 'Apple Music',
    duration: typeof r.trackTimeMillis === 'number' ? Math.round(r.trackTimeMillis / 1000) : 0,
    explicit: r.trackExplicitness === 'explicit'
  };
}

async function musicSearch(query) {
  const q = encodeURIComponent(query);
  const [dz, ap] = await Promise.allSettled([
    musicFetchJson(`https://api.deezer.com/search?q=${q}&limit=25`),
    musicFetchJson(`https://itunes.apple.com/search?media=music&limit=25&term=${q}`)
  ]);
  const tracks = [];
  if (dz.status === 'fulfilled') {
    (dz.value.data || []).filter((t) => t.preview).forEach((t) => tracks.push(musicFromDeezer(t, 'Deezer')));
  }
  if (ap.status === 'fulfilled') {
    (ap.value.results || []).filter((r) => r.previewUrl).forEach((r) => tracks.push(musicFromItunes(r)));
  }
  // Dedupe by title+artist (case-insensitive), keep the first occurrence.
  const seen = new Set();
  return tracks.filter((t) => {
    const key = `${t.title}|${t.artist}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

async function musicChart() {
  const data = await musicFetchJson('https://api.deezer.com/chart/0/tracks?limit=20');
  return (data.data || []).filter((t) => t.preview).map((t) => musicFromDeezer(t, 'Trending'));
}

async function handleMusicRequest(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const chart = url.searchParams.get('chart') === '1';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const key = chart ? 'chart' : `q:${q.toLowerCase()}`;
  const now = Date.now();
  const cached = musicCache.get(key);
  if (cached && now - cached.at < MUSIC_CACHE_TTL_MS) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, tracks: cached.tracks }));
    return;
  }
  if (!chart && !q) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'A q query parameter is required (or chart=1).' }));
    return;
  }
  try {
    const tracks = chart ? await musicChart() : await musicSearch(q);
    musicCache.set(key, { at: now, tracks });
    if (musicCache.size > 40) musicCache.delete(musicCache.keys().next().value);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, tracks }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'Music search is unavailable right now — try again in a moment.' }));
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

  // Dynamic endpoints: AI chat (POST), the music search proxy (GET), and the
  // account registry (GET /api/accounts).
  if (req.method === 'POST' && new URL(req.url, 'http://glitchit.local').pathname === '/api/chat') {
    await handleChatRequest(req, res);
    return;
  }
  if (req.method === 'GET' && new URL(req.url, 'http://glitchit.local').pathname === '/api/music') {
    await handleMusicRequest(req, res);
    return;
  }
  if (req.method === 'GET' && new URL(req.url, 'http://glitchit.local').pathname === '/api/accounts') {
    await accountsHandler(req, res);
    return;
  }
  if (req.method === 'GET' && new URL(req.url, 'http://glitchit.local').pathname === '/api/livekit-token') {
    await livekitTokenHandler(req, res);
    return;
  }
  if (new URL(req.url, 'http://glitchit.local').pathname === '/api/nvidia-video') {
    await nvidiaVideoHandler(req, res);
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
module.exports = { createRateLimiter, RATE_LIMIT, chatStream, handleChatRequest, getNvidiaKey, handleMusicRequest, musicSearch, musicChart };

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`GlitchIt preview running at http://0.0.0.0:${PORT}`);
  });
}
