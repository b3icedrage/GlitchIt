// GlitchIt — static build (zero dependencies, Node-only, exits after copying).
// The site has no framework or transpile step: "building" means assembling the
// static output into dist/ so the managed hosting has a clean artifact to
// serve. server.js is the dev/preview server and is intentionally NOT part of
// the static output (production hosting serves static files, not a Node app).
'use strict';

const { cp, mkdir, rm, readFile, writeFile, readdir } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { resolve, join } = require('node:path');

const ROOT = resolve(__dirname);
const OUT = join(ROOT, 'dist');

// Everything the site needs at runtime. vercel.json + api/ ship for Vercel
// hosting; the static hosting ignores what it does not need.
const ENTRIES = [
  'index.html',
  'about.html',
  'robots.txt',
  'sitemap.xml',
  'search.html',
  'glitches.html',
  'post.html',
  'messages.html',
  'chat.html',
  'live.html',
  'activity.html',
  'channels.html',
  'shop.html',
  'profile.html',
  'user.html',
  'auth.html',
  'terms.html',
  'privacy.html',
  'manifest.json',
  'premium.html',
  'wallet.html',
  'receipt.html',
  'payment-success.html',
  'camera.html',
  'admin.html',
  'server.js',
  'package.json',
  'src',
  'sw.js',
  'ads.txt',
  'vercel.json',
  'api',
  'icon.svg',
];

// ── Cache-busting ────────────────────────────────────────────────────
// Pages reference assets as `src/main.js?v=43` — those numbers used to be
// bumped by hand across 22 HTML files and drifted out of sync (stale caches
// after deploys). Instead, stamp every `?v=` on a local asset with a short
// content hash of the file it points at: edit the file → the hash changes →
// the query string changes → browsers re-fetch. No manual bumps, no drift.
function contentHash(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

async function assetVersion(relPath) {
  try {
    return contentHash(await readFile(join(ROOT, relPath)));
  } catch (e) {
    return '0'; // missing asset — leave the reference as-is
  }
}

// Rewrite `src/anything.(js|css)?v=<old>` in one HTML string using the real
// content hash of the referenced file. Only local, relative references are
// touched — CDN URLs (Firebase, jsDelivr…) are left alone.
async function stampAssetVersions(html) {
  const pattern = /(src|href)="((?:\.\/)?[A-Za-z0-9_\/-]+\.(?:js|css))\?v=[^" ]*"/g;
  const cache = new Map();
  const replacements = await Promise.all(
    Array.from(html.matchAll(pattern)).map(async (m) => {
      const rel = m[2].replace(/^\.\//, '');
      if (!cache.has(rel)) cache.set(rel, await assetVersion(rel));
      return [m[0], `${m[1]}="${m[2]}?v=${cache.get(rel)}"`];
    })
  );
  let out = html;
  for (const [from, to] of replacements) out = out.split(from).join(to);
  return out;
}

async function stampHtmlVersions() {
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.html'));
  let stamped = 0;
  for (const file of files) {
    const p = join(OUT, file);
    const html = await readFile(p, 'utf8');
    const next = await stampAssetVersions(html);
    if (next !== html) {
      await writeFile(p, next);
      stamped += 1;
    }
  }
  console.log(`Stamped content-hash cache versions in ${stamped}/${files.length} pages`);
}

(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const entry of ENTRIES) {
    await cp(join(ROOT, entry), join(OUT, entry), { recursive: true, force: true });
  }
  await stampHtmlVersions();
  console.log(`GlitchIt built into ${OUT}`);
})().catch((err) => {
  console.error('GlitchIt build failed:', err);
  process.exit(1);
});
