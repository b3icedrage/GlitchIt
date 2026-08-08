// GlitchIt Create Hub — the chooser that appears when you open the Create page.
// Pick exactly what you want to make: record a Glitch, record a video for your
// feed or story, take a picture to post to the feed or story, or go Live.
//
// It drives the existing studio through the window.__glitchCreate bridge that
// attachCreateStudio() (src/main.js) installs: pickTab() activates the right
// POST/STORY/REEL tab and setVideoMode() decides whether the shutter records
// video or captures a photo.
(function () {
  'use strict';

  const hub = document.getElementById('create-hub');
  if (!hub || document.body.dataset.page !== 'create') return;

  const params = new URLSearchParams(location.search);
  // Editing an existing story (create.html?editStory=latest) and deep links
  // straight to the camera (?camera=1) skip the chooser entirely.
  if (params.has('editStory') || params.get('camera') === '1') {
    hub.hidden = true;
    return;
  }

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    hub.classList.add('leaving');
    setTimeout(() => { hub.hidden = true; }, 240);
  };

  // The bridge lives inside attachCreateStudio(), which boots after an async
  // auth check — poll briefly so the first tap always finds it.
  let bridge = null;
  let pollTries = 0;
  const pollBridge = setInterval(() => {
    bridge = window.__glitchCreate || null;
    if (bridge || ++pollTries > 60) clearInterval(pollBridge);
  }, 100);

  const ready = () => bridge || window.__glitchCreate || null;

  const pick = (choice) => {
    clearInterval(pollBridge);
    bridge = ready();
    switch (choice) {
      case 'glitch':        // short video with glitch effects → the REEL pipeline
        bridge?.pickTab('videos');
        bridge?.setVideoMode(true);
        break;
      case 'feed-video':    // record a video that lands in your feed
        bridge?.pickTab('feed');
        bridge?.setVideoMode(true);
        break;
      case 'story-video':   // record a video that vanishes in 24 hours
        bridge?.pickTab('stories');
        bridge?.setVideoMode(true);
        break;
      case 'picture-feed':  // take a photo → feed
        bridge?.pickTab('feed');
        bridge?.setVideoMode(false);
        break;
      case 'picture-story': // take a photo → story
        bridge?.pickTab('stories');
        bridge?.setVideoMode(false);
        break;
      case 'live':          // go straight to the live studio
        location.href = 'live.html';
        return;
      default:
        break;
    }
    // Make sure the camera is running so the user sees themselves immediately
    // (the Live-page style self-view) the moment they start recording or
    // snapping a picture — no extra tap needed.
    const cam = bridge && bridge.ensureCamera ? bridge.ensureCamera() : Promise.resolve();
    close();
    cam.catch && cam.catch(() => {});
  };

  hub.addEventListener('click', (event) => {
    const item = event.target.closest('[data-create]');
    if (item) { pick(item.dataset.create); return; }
    if (event.target.closest('#create-hub-close') || event.target.closest('#create-hub-camera')) {
      close();
      return;
    }
    // Tapping the dark backdrop dismisses the chooser and uses the camera.
    if (event.target === hub) close();
  });

  window.addEventListener('keydown', (event) => {
    if (hub.hidden) return;
    if (event.key === 'Escape') close();
  });
})();
