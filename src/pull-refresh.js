// GlitchIt — Pull-to-refresh for the home feed
// Activates only on data-page="home". Shows a spinner at the top of the
// scroll area when the user pulls down, then re-renders the feed + stories
// via window.hydrateHomeFeed() when released past the threshold.
(function () {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'home') return;

  const main = document.querySelector('main');
  if (!main) return;

  const THRESHOLD = 70; // px to pull before refresh triggers
  const MAX_PULL = 110; // cap the visual travel distance
  const INDICATOR_H = 44; // height of the visible spinner row

  // ── indicator element ──────────────────────────────────────────────
  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh-indicator';
  indicator.innerHTML =
    '<div class="pull-refresh-spinner">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12a9 9 0 1 1-2.2-6"/>' +
        '<polyline points="21 3 21 9 15 9"/>' +
      '</svg>' +
    '</div>' +
    '<span>Pull to refresh</span>';
  indicator.style.opacity = '0';
  main.prepend(indicator);

  let startY = 0;
  let pulling = false;
  let refreshing = false;

  function atTop() {
    return main.scrollTop <= 0;
  }

  function setStatus(status) {
    var span = indicator.querySelector('span');
    var spinner = indicator.querySelector('.pull-refresh-spinner');
    if (status === 'pulling') {
      indicator.classList.add('active');
      span.textContent = 'Pull to refresh';
      spinner.classList.remove('spinning');
    } else if (status === 'ready') {
      span.textContent = 'Release to refresh';
      spinner.classList.remove('spinning');
    } else if (status === 'refreshing') {
      span.textContent = 'Refreshing…';
      spinner.classList.add('spinning');
    } else {
      indicator.classList.remove('active');
    }
  }

  function reset() {
    indicator.style.transform = '';
    indicator.style.opacity = '0';
    setStatus('hide');
  }

  // ── touch handlers ─────────────────────────────────────────────────
  main.addEventListener('touchstart', function (e) {
    if (refreshing || !atTop()) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  main.addEventListener('touchmove', function (e) {
    if (!pulling || refreshing) return;
    var delta = e.touches[0].clientY - startY;
    if (delta <= 0 || !atTop()) { reset(); return; }
    var dist = Math.min(delta * 0.55, MAX_PULL); // rubber-band resistance
    if (dist > 4) {
      e.preventDefault(); // prevent native overscroll while we handle it
    }
    indicator.style.transform = 'translateY(' + (dist - INDICATOR_H) + 'px)';
    indicator.style.opacity = String(Math.min(1, dist / THRESHOLD));
    setStatus(dist >= THRESHOLD ? 'ready' : 'pulling');
  }, { passive: false });

  main.addEventListener('touchend', function () {
    if (!pulling) return;
    pulling = false;
    var wasReady = indicator.querySelector('span').textContent === 'Release to refresh';
    if (wasReady) {
      setStatus('refreshing');
      indicator.style.transform = 'translateY(' + (INDICATOR_H * 0.3) + 'px)';
      indicator.style.opacity = '1';
      doRefresh();
    } else {
      reset();
    }
  });

  // ── refresh action ─────────────────────────────────────────────────
  async function doRefresh() {
    refreshing = true;
    try {
      if (typeof window.hydrateHomeFeed === 'function') {
        window.hydrateHomeFeed();
      }
      // Brief pause so the spinner is visible even when local data is instant.
      await new Promise(function (r) { setTimeout(r, 600); });
    } catch (err) { /* ignore */ }
    refreshing = false;
    reset();
  }
})();
