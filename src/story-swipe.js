// GlitchIt — left-edge swipe on the home feed opens the story camera.
// Dragging from the left edge of the screen slides in a peek panel; releasing
// past the threshold navigates to camera.html, otherwise it snaps back.
// Loaded only on index.html (see sw.js shell list).
(function () {
  'use strict';

  const EDGE = 28;       // px from the left edge that starts the gesture
  const THRESHOLD = 90;  // px of rightward drag needed to open the camera

  const PEEK = document.createElement('div');
  PEEK.className = 'story-swipe-peek';
  PEEK.setAttribute('aria-hidden', 'true');
  PEEK.innerHTML = '<span class="story-swipe-mark" aria-hidden="true">ϟ</span><b>Story camera</b><small>POST · STORY · REEL · LIVE</small>';
  document.body.appendChild(PEEK);

  let sx = 0;
  let sy = 0;
  let lastDx = 0;
  let active = false;
  let dragging = false;

  function show(dx) {
    const p = Math.min(1, Math.max(0, dx / 240));
    PEEK.style.transform = `translateX(${(-100 + p * 100).toFixed(2)}%)`;
    PEEK.style.opacity = String(Math.min(1, 0.35 + p * 0.65));
  }
  function snapBack() {
    PEEK.classList.remove('dragging');
    PEEK.style.transform = '';
    PEEK.style.opacity = '';
  }
  function finish(dx) {
    if (!dragging) { active = false; return; }
    if (dx >= THRESHOLD) {
      PEEK.classList.remove('dragging');
      PEEK.classList.add('go');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* ignore */ } }
      setTimeout(() => { location.href = 'camera.html'; }, 90);
    } else {
      snapBack();
    }
    active = false;
    dragging = false;
  }

  window.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    if (!t || t.clientX > EDGE) return;
    sx = t.clientX;
    sy = t.clientY;
    lastDx = 0;
    active = true;
    dragging = false;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (!dragging) {
      if (dx > 12 && dx > Math.abs(dy) * 1.15) {
        dragging = true;
        PEEK.classList.add('dragging');
      } else if (Math.abs(dy) > 12) {
        active = false;
        return;
      }
    }
    if (dragging) {
      if (e.cancelable) e.preventDefault();
      lastDx = dx;
      show(dx);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => finish(lastDx), { passive: true });
  window.addEventListener('touchcancel', () => {
    if (dragging) snapBack();
    active = false;
    dragging = false;
  }, { passive: true });

  // Desktop bonus: drag from the left edge with a mouse (fine pointers only).
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.clientX > EDGE) return;
      sx = e.clientX;
      sy = e.clientY;
      lastDx = 0;
      active = true;
      dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!active) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!dragging) {
        if (dx > 12 && dx > Math.abs(dy) * 1.15) {
          dragging = true;
          PEEK.classList.add('dragging');
        } else if (Math.abs(dy) > 12) {
          active = false;
          return;
        }
      }
      if (dragging) { lastDx = dx; show(dx); }
    });
    window.addEventListener('mouseup', () => finish(lastDx));
  }
})();
