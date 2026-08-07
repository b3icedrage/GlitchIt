// Home-only gesture: swipe right on the feed to open the camera/create page.
(function attachHomeCreateSwipe() {
  if (document.body?.dataset.page !== 'home' || document.body.dataset.createSwipeReady) return;
  document.body.dataset.createSwipeReady = 'true';

  let startX = 0;
  let startY = 0;
  let ignored = false;
  const isInteractive = (target) => target?.closest('a, button, input, textarea, select, video, [contenteditable="true"], .stories');

  document.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (!touch || isInteractive(event.target)) {
      ignored = true;
      return;
    }
    ignored = false;
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (ignored) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (deltaX >= 84 && deltaX > Math.abs(deltaY) + 24) window.location.assign('create.html');
    ignored = false;
  }, { passive: true });
})();
