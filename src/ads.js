// ============ GLITCHIT MONETIZATION: AdSense placements ============
// Self-contained module — it never touches main.js's feed rendering. It
// watches the site's feeds and inserts sponsored placements that serve the
// in-feed ad unit created in the AdSense dashboard:
//   • slide  — full-screen "Sponsored" slide after every N reels
//              (glitches.html feed + shop.html reel)
//   • feed   — compact in-feed card after every N posts (index.html home feed)
//   • banner — full-width unit at the top of search results (search.html)
// If AD_SLOT is ever cleared, the reel slides fall back to a branded sponsor
// placeholder (the feed/banner placements simply don't inject) so the app
// never renders an empty gray box.
(function () {
  'use strict';

  const AD_CLIENT = 'ca-pub-6010592277770538';
  const AD_SLOT = '9812874390'; // in-feed ad unit (fluid)
  const AD_LAYOUT_KEY = '-6t+ed+2i-1n-4w';
  const EVERY = 6; // insert a placement after every 6 cards
  const hasUnit = Boolean(String(AD_SLOT || '').trim());

  // Feed containers and the kind of placement they get. Card selectors pick
  // the real content cards (reel cards, posts) so ads land between them.
  const FEEDS = [
    { host: '#video-feed', cardSel: '.video-card', kind: 'slide' },
    { host: '#glitches-reel', cardSel: '.video-card', kind: 'slide' },
    { host: '#upload-feed', cardSel: '.post', kind: 'feed' },
  ];

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

  // Search: one full-width sponsored unit above the Top results grid.
  function injectSearchBanner() {
    if (!hasUnit) return;
    const grid = document.getElementById('sr-media-grid');
    if (!grid || !grid.parentElement) return;
    if (grid.parentElement.querySelector(':scope > .ad-banner')) return;
    const node = document.createElement('template');
    node.innerHTML = cardHtml('banner').trim();
    grid.parentElement.insertBefore(node.content.firstChild, grid);
    pushUnits(grid.parentElement);
  }

  // Taps on the sponsored reel slide must not open the reel viewer:
  // reels-viewer.js skips taps that land on a button, so the placeholder is a
  // button and the real ad unit is an iframe that swallows its own clicks.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('load', start); // catches late re-renders
})();
