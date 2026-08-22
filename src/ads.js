// ============ GLITCHIT MONETIZATION: AdSense placements ============
// Self-contained module — it never touches main.js's feed rendering. It
// watches the site's feeds and inserts sponsored placements that serve the
// in-feed ad unit created in the AdSense dashboard:
//   • slide  — full-screen "Sponsored" slide after every N reels
//              (glitches.html feed + shop.html reel)
//   • feed   — compact in-feed card after every N posts (index.html home feed)
//   • banner — full-width unit at the top of search results (search.html)
//
// AdSense policy — ads are ONLY allowed on screens with real content:
//   • Ads never render on pages without content, under construction, or used
//     for alerts / navigation / other behavioral purposes.
//   • Every placement requires a minimum number of *visible, real* content
//     cards before it injects, so an empty feed, loading state or empty
//     search result screen NEVER shows an ad (or even an ad placeholder).
//   • Hidden containers (tabs, off-screen rails) are skipped.
// If AD_SLOT is ever cleared, the reel slides fall back to a branded sponsor
// placeholder (the feed/banner placements simply don't inject) so the app
// never renders an empty gray box.
(function () {
  'use strict';

  const AD_CLIENT = 'ca-pub-6010592277770538';
  const AD_SLOT = '9812874390'; // in-feed ad unit (fluid)
  const AD_LAYOUT_KEY = '-6t+ed+2i-1n-4w';
  const EVERY = 6; // insert a placement after every 6 cards
  const MIN_SEARCH_RESULTS = 4; // banner only with a real results grid
  const hasUnit = Boolean(String(AD_SLOT || '').trim());

  // Screens that carry real content. Any other page (auth, camera, live,
  // messages, chat, activity, channels, premium, privacy, about…) must never
  // host ads — they are entry/utility screens, not content screens.
  const CONTENT_PAGES = ['home', 'glitches', 'search', 'shop'];
  const PAGE = (document.body && document.body.dataset && document.body.dataset.page) || '';
  const isContentPage = CONTENT_PAGES.includes(PAGE);

  // Feed containers and the kind of placement they get. Card selectors pick
  // the real content cards (reel cards, posts) so ads land between them.
  const FEEDS = [
    { host: '#video-feed', cardSel: '.video-card', kind: 'slide' },
    { host: '#glitches-reel', cardSel: '.video-card', kind: 'slide' },
    { host: '#upload-feed', cardSel: '.post', kind: 'feed' },
  ];

  // True only when the element (and its ancestors) is actually visible on
  // screen — ads must never render into hidden tabs, collapsed rails or
  // display:none containers (policy: no ads on non-content screens).
  function isVisible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.nodeType !== 1) { node = node.parentNode; continue; }
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      node = node.parentNode;
    }
    return true;
  }

  function unitHtml() {
    return '<ins class="adsbygoogle" style="display:block" data-ad-format="fluid" data-ad-layout-key="' + AD_LAYOUT_KEY + '" data-ad-client="' + AD_CLIENT + '" data-ad-slot="' + AD_SLOT + '"></ins>';
  }

  function cardHtml(kind) {
    const head = '<div class="ad-head"><span class="ad-label">Sponsored</span></div>';
    if (kind === 'slide') {
      const inner = hasUnit
        ? unitHtml()
        : '<button type="button" class="ad-placeholder"><span class="ad-placeholder-mark">▣</span><strong>Sponsored</strong><p>Your brand could be the next Glitch — reach a feed of creators who love short-form video.</p><em>Ads appear here once the ad unit is linked.</em></button>';
      return '<article class="video-card ad-card">' + head + inner + '</article>';
    }
    if (kind === 'banner') {
      return '<aside class="ad-banner">' + head + unitHtml() + '</aside>';
    }
    return '<article class="ad-feed-card">' + head + unitHtml() + '</article>';
  }

  function pushUnits(root) {
    if (!hasUnit) return;
    // Push into the queue even if the async loader script hasn't initialized
    // yet — adsbygoogle.push({}) is processed the moment the loader arrives.
    root.querySelectorAll('.adsbygoogle').forEach(function () {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ad failed to fill — card stays branded */ }
    });
  }

  // glitches page: cards live in #video-feed (display:contents) inside the reel.
  function hostOf(container) {
    if (!container) return null;
    if (container.id === 'video-feed' || container.id === 'upload-feed') return container;
    const inner = container.querySelector('#video-feed');
    if (inner && inner.children.length) return inner;
    return container;
  }

  function injectEvery(host, cardSel, kind, skipClass) {
    if (!host || !isVisible(host)) return; // no ads on hidden/empty screens
    const cards = Array.prototype.filter.call(host.children, (el) =>
      el.classList && el.matches && el.matches(cardSel) && !el.classList.contains(skipClass));
    if (cards.length < EVERY) return; // too few cards yet — an ad would crowd the feed
    let inserted = 0;
    cards.forEach((card, i) => {
      if ((i + 1) % EVERY !== 0) return;
      const next = card.nextElementSibling;
      if (next && next.classList && next.classList.contains(skipClass)) return; // already injected
      const node = document.createElement('template');
      node.innerHTML = cardHtml(kind).trim();
      card.after(node.content.firstChild);
      inserted++;
    });
    if (inserted) pushUnits(host);
  }

  function start() {
    if (!isContentPage) return; // auth/camera/live/messages/… never host ads
    FEEDS.forEach((feed) => {
      const el = document.querySelector(feed.host);
      if (!el || el._glitchAdsObserved) return;
      el._glitchAdsObserved = true;
      const skipClass = feed.kind === 'slide' ? 'ad-card' : 'ad-feed-card';
      const run = () => {
        const host = hostOf(el);
        if (!host) return;
        if (feed.kind === 'feed' && !hasUnit) return; // no real unit → no placeholder in home feed
        injectEvery(host, feed.cardSel, feed.kind, skipClass);
      };
      run();
      new MutationObserver(run).observe(el, { childList: true });
    });
    injectSearchBanner();
  }

  // Search: one full-width sponsored unit above the Top results grid — and
  // only when the grid actually holds results (never on an empty/no-match
  // screen, which is exactly the "screen without content" AdSense rejects).
  function injectSearchBanner() {
    if (!hasUnit || PAGE !== 'search') return;
    const grid = document.getElementById('sr-media-grid');
    if (!grid || !grid.parentElement || !isVisible(grid)) return;
    if (grid.parentElement.querySelector(':scope > .ad-banner')) return;
    if (grid.querySelectorAll('.sr-thumb').length < MIN_SEARCH_RESULTS) return;
    const node = document.createElement('template');
    node.innerHTML = cardHtml('banner').trim();
    grid.parentElement.insertBefore(node.content.firstChild, grid);
    pushUnits(grid.parentElement);
  }

  // Re-evaluate the search banner as results arrive; the grid has no observer
  // of its own because search.js re-renders it, so watch the grid for changes.
  function watchSearch() {
    if (!hasUnit || PAGE !== 'search') return;
    const grid = document.getElementById('sr-media-grid');
    if (!grid || grid._glitchAdsSearchObserved) return;
    grid._glitchAdsSearchObserved = true;
    new MutationObserver(injectSearchBanner).observe(grid, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { start(); watchSearch(); });
  } else {
    start();
    watchSearch();
  }
  window.addEventListener('load', () => { start(); watchSearch(); }); // catches late re-renders
})();
