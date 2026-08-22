// GlitchIt — static build (zero dependencies, Node-only, exits after copying).
// The site has no framework or transpile step: "building" means assembling the
// static output into dist/ so the managed hosting has a clean artifact to
// serve. server.js is the dev/preview server and is intentionally NOT part of
// the static output (production hosting serves static files, not a Node app).
'use strict';

const { cp, mkdir, rm } = require('node:fs/promises');
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
  'camera.html',
  'src',
  'sw.js',
  'ads.txt',
  'vercel.json',
  'api',
  'icon.svg',
];

(async () => {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const entry of ENTRIES) {
    await cp(join(ROOT, entry), join(OUT, entry), { recursive: true, force: true });
  }
  console.log(`GlitchIt built into ${OUT}`);
})().catch((err) => {
  console.error('GlitchIt build failed:', err);
  process.exit(1);
});
