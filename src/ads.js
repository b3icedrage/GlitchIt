// ============ GLITCHIT MONETIZATION: in-feed sponsored slides (AdSense) ============
// Self-contained module — it never touches main.js's feed rendering. It watches
// the reel feed containers and inserts a full-screen "Sponsored" slide after
// every N reels, then fills any AdSense units that are configured.
//
// To start earning: create an in-feed ad unit in your AdSense dashboard
// (Ads > Ad units > In-feed) and paste its slot id into AD_SLOT below. Until
// then the slide shows a branded sponsor placeholder so the feed never renders
// an empty gray box.
(function () {
  'use strict';

  const AD_CLIENT = 'ca-pub-6585667805986181';
  const AD_SLOT = ''; // TODO: paste your in-feed ad-unit slot id here
  const EVERY = 6; // insert a sponsored slide after every 6 reels

  // Containers that receive reel cards: #video-feed (glitches page) and
  // #glitches-reel (shop page reel). Both are watched; injection picks the
  // innermost container that actually holds the cards.
  const CONTAINERS = ['#video-feed', '#glitches-reel'];

  function adCardHtml() {
    const slot = String(AD_SLOT || '').trim();
    const inner = slot
      ? '<ins class="adsbygoogle" style="display:block" data-ad-client="' + AD_CLIENT + '" data-ad-slot="' + slot + '" data-ad-format="auto" data-full-width-responsive="true"></ins>'
      : '<button type="button" class="ad-placeholder"><span class="ad-placeholder-mark">▣</span><strong>Sponsored</strong><p>Your brand could be the next Glitch — reach a feed of creators who love short-form video.</p><em>Ads appear here once the ad unit is linked.</em></button>';
    return '<article class="video-card ad-card"><div class="ad-head"><span class="ad-label">Sponsored</span></div>' + inner + '</article>';
  }

  function pushUnits(root) {
    if (!AD_SLOT || !window.adsbygoogle) return;
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
