// ============ GLITCHIT MONETIZATION: in-feed sponsored slides (AdSense) ============
// Self-contained module — it never touches main.js's feed rendering. It watches
// the reel feed containers and inserts a full-screen "Sponsored" slide after
// every N reels, then fills any AdSense units that are configured.
//
// The in-feed ad unit below was created in the AdSense dashboard; the slide
// serves it between reels. If AD_SLOT is ever cleared, the slide falls back to
// a branded sponsor placeholder so the feed never renders an empty gray box.
(function () {
  'use strict';

  const AD_CLIENT = 'ca-pub-6010592277770538';
  const AD_SLOT = '9812874390'; // in-feed ad unit (fluid)
  const AD_LAYOUT_KEY = '-6t+ed+2i-1n-4w';
  const EVERY = 6; // insert a sponsored slide after every 6 reels

  // Containers that receive reel cards: #video-feed (glitches page) and
  // #glitches-reel (shop page reel). Both are watched; injection picks the
  // innermost container that actually holds the cards.
  const CONTAINERS = ['#video-feed', '#glitches-reel'];

  function adCardHtml() {
    const slot = String(AD_SLOT || '').trim();
    const inner = slot
      ? '<ins class="adsbygoogle" style="display:block" data-ad-format="fluid" data-ad-layout-key="' + AD_LAYOUT_KEY + '" data-ad-client="' + AD_CLIENT + '" data-ad-slot="' + slot + '"></ins>'
      : '<button type="button" class="ad-placeholder"><span class="ad-placeholder-mark">▣</span><strong>Sponsored</strong><p>Your brand could be the next Glitch — reach a feed of creators who love short-form video.</p><em>Ads appear here once the ad unit is linked.</em></button>';
    return '<article class="video-card ad-card"><div class="ad-head"><span class="ad-label">Sponsored</span></div>' + inner + '</article>';
  }

  function pushUnits(root) {
    if (!AD_SLOT) return;
    // Push into the queue even if the async loader script hasn't initialized
    // yet — adsbygoogle.push({}) is processed the moment the loader arrives.
    root.querySelectorAll('.adsbygoogle').forEach(function () {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ad failed to fill — card stays branded */ }
    });
  }

  function hostOf(container) {
    if (!container) return null;
    // glitches page: cards live in #video-feed (display:contents) inside the reel.
    if (container.id === 'video-feed') return container;
    const inner = container.querySelector('#video-feed');
    if (inner && inner.children.length) return inner;
    return container;
  }

  function injectInto(container) {
    const host = hostOf(container);
    if (!host || !host.children.length) return;
    const cards = Array.prototype.filter.call(host.children, (el) =>
      el.classList && el.classList.contains('video-card') && !el.classList.contains('ad-card'));
    if (cards.length < EVERY) return; // too few reels yet — an ad would crowd the feed
    let inserted = 0;
    cards.forEach((card, i) => {
      if ((i + 1) % EVERY !== 0) return;
      const next = card.nextElementSibling;
      if (next && next.classList && next.classList.contains('ad-card')) return; // already injected
      const node = document.createElement('template');
      node.innerHTML = adCardHtml().trim();
      card.after(node.content.firstChild);
      inserted++;
    });
    if (inserted) pushUnits(host);
  }

  function start() {
    CONTAINERS.forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el || el._glitchAdsObserved) return;
      el._glitchAdsObserved = true;
      injectInto(el);
      new MutationObserver(() => injectInto(el)).observe(el, { childList: true });
    });
  }

  // Taps on the sponsored slide must not open the reel viewer: reels-viewer.js
  // skips taps that land on a button, so the placeholder is a button and the
  // real ad unit is an iframe that swallows its own clicks.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('load', start); // catches late re-renders
})();
