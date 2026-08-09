// GlitchIt — service worker caching layer (registered by src/main.js).
// Quota-friendly strategy (video is never cached):
//  - App shell:        precached at install so the app opens instantly and works offline.
//  - Navigations:      network-first, cached fallback for offline.
//  - Same-origin assets: stale-while-revalidate (instant repeat loads).
//  - Supabase images:    stale-while-revalidate with a small FIFO budget.
'use strict';

const CACHE_NAME = 'glitchit-cache-v1';
const MEDIA_CACHE_NAME = 'glitchit-media-v1';
const MEDIA_BUDGET = 40;
const ASSET_RE = /\.(css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?)$/;
const MEDIA_RE = /supabase\.co\/storage/;

// The app shell: every page plus the core assets it needs. Fetched once during
// install so first loads are instant and later loads keep working offline
// (navigations fall back to this cache when the network is unavailable).
// Keep this list in sync with the versioned asset bumps in the HTML files.
const SHELL_URLS = [
  './',
  './index.html',
  './search.html',
  './glitches.html',
  './messages.html',
  './chat.html',
  './live.html',
  './activity.html',
  './shop.html',
  './profile.html',
  './auth.html',
  './camera.html',
  './src/styles.css',
  './src/bottombar.css?v=2',
  './src/profile-media.css',
  './src/music-ui.css?v=2',
  './src/ai-chat.css',
  './src/dm-inbox.css',
  './src/main.js?v=15',
  './src/story-swipe.js',
  './src/music-ui.js?v=2',
  './src/profile-avatar.js',
  './src/ai-chat.js?v=3',
  './src/story-camera.css',
  './src/story-camera.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => null)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== MEDIA_CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Serve from cache instantly; refresh in the background. Falls back to the
// network when there is no cached copy.
function staleWhileRevalidate(cacheName, request) {
  return caches.open(cacheName).then((cache) => (
    cache.match(request).then((hit) => {
      const refreshed = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
            if (cacheName === MEDIA_CACHE_NAME) trimMedia(cache);
          }
          return response;
        })
        .catch(() => null);
      if (hit) return hit; // instant: don't block on the network
      return refreshed.then((response) => response || Response.error());
    })
  ));
}

async function trimMedia(cache) {
  const keys = await cache.keys();
  if (keys.length <= MEDIA_BUDGET) return;
  await Promise.all(keys.slice(0, keys.length - MEDIA_BUDGET).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Page navigations: always try the network so new deploys show instantly.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request) || await cache.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  const url = new URL(request.url);

  // Supabase-stored images: SWR with a budget (video passes through untouched).
  if (MEDIA_RE.test(url.href) && /\.(png|jpe?g|webp|gif|svg)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(MEDIA_CACHE_NAME, request));
    return;
  }

  // Same-origin static assets: SWR (cache keys include ?v= bumps).
  if (url.origin === self.location.origin && ASSET_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(CACHE_NAME, request));
  }
});
