// GlitchIt — service worker caching layer (registered by src/main.js).
// Quota-friendly strategy (video is never cached):
//  - App shell:          precached at install so the app opens instantly and works offline.
//  - Navigations:        network-first, cached fallback for offline.
//  - Same-origin assets: stale-while-revalidate (instant repeat loads).
//  - Supabase images:    stale-while-revalidate with a small FIFO budget.
//  - Map (Leaflet + OSM): SDK is stale-while-revalidate; tiles are cache-first
//    (immutable URLs) with a FIFO budget so maps open instantly on repeat visits.
'use strict';

const CACHE_NAME = 'glitchit-cache-v3';
const MEDIA_CACHE_NAME = 'glitchit-media-v2';
const MEDIA_BUDGET = 40;
const MAP_CACHE_NAME = 'glitchit-map-v1';
const TILE_BUDGET = 400; // ~4-8 MB of tiles; trims oldest-first once full
const ASSET_RE = /\.(css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?)$/;
const MEDIA_RE = /supabase\.co\/storage/;
const OSM_TILE_RE = /tile\.openstreetmap\.org\//;
const LEAFLET_RE = /unpkg\.com\/leaflet@/;

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
  './channels.html',
  './shop.html',
  './profile.html',
  './user.html',
  './auth.html',
  './camera.html',
  './src/styles.css?v=9',
  './src/bottombar.css?v=2',
  './src/profile-media.css',
  './src/music-ui.css?v=2',
  './src/ai-chat.css',
  './src/dm-inbox.css?v=2',
  './src/social.css?v=2',
  './src/main.js?v=36',
  './src/calls.css?v=2',
  './src/calls.js?v=2',
  './src/channels.css?v=1',
  './src/channels.js?v=1',
  'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js',
  './src/social-wire.js?v=8',
  './src/reels-viewer.js?v=3',
  './src/edit-profile.js?v=3',
  './src/edit-profile.css?v=3',
  './src/story-features.js?v=3',
  './src/story-extras.css?v=2',
  './src/reels.css?v=2',
  './src/story-swipe.js',
  './src/music-ui.js?v=2',
  './src/profile-avatar.js',
  './src/ai-chat.js?v=3',
  './src/story-camera.css?v=2',
  './src/story-camera.js?v=3',
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
    await Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== MEDIA_CACHE_NAME && key !== MAP_CACHE_NAME).map((key) => caches.delete(key)));
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
            if (cacheName === MEDIA_CACHE_NAME) trimCache(cache, MEDIA_BUDGET);
            if (cacheName === MAP_CACHE_NAME) trimCache(cache, TILE_BUDGET);
          }
          return response;
        })
        .catch(() => null);
      if (hit) return hit; // instant: don't block on the network
      return refreshed.then((response) => response || Response.error());
    })
  ));
}

// Cache-first for immutable URLs (map tiles): serve the cached copy instantly,
// fetching only on a miss. Trimmed FIFO-style once it exceeds the budget.
function cacheFirst(cacheName, request, budget) {
  return caches.open(cacheName).then((cache) => (
    cache.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
          if (budget) trimCache(cache, budget);
        }
        return response;
      }).catch(() => Response.error());
    })
  ));
}

async function trimCache(cache, budget) {
  const keys = await cache.keys();
  if (keys.length <= budget) return;
  await Promise.all(keys.slice(0, keys.length - budget).map((key) => cache.delete(key)));
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

  // OpenStreetMap tiles: cache-first — tile URLs are immutable, so the cached
  // copy is always correct; only fetch when a tile is seen for the first time.
  if (OSM_TILE_RE.test(url.href)) {
    event.respondWith(cacheFirst(MAP_CACHE_NAME, request, TILE_BUDGET));
    return;
  }

  // Leaflet SDK from unpkg: stale-while-revalidate so pickers and map cards
  // open instantly on repeat visits.
  if (LEAFLET_RE.test(url.href) && ASSET_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(MAP_CACHE_NAME, request));
    return;
  }

  // Same-origin static assets: SWR (cache keys include ?v= bumps).
  if (url.origin === self.location.origin && ASSET_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(CACHE_NAME, request));
  }
});
