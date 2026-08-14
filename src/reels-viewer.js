// GlitchIt — full-screen immersive Glitch viewer (Reels-style player).
// Loaded AFTER src/main.js on the glitches, search, profile, user and shop
// pages. Tapping a reel anywhere — a Glitches feed card, a search Reels
// thumbnail, or a Posts/Reels grid tile on profile/user pages — opens the
// viewer at that video, and swiping scrolls through every reel loaded on that
// page (muted autoplay, one video at a time, sound toggle in the header).
//
// The viewer reuses the app's existing pieces instead of re-implementing
// them: like / comment / share / save / follow buttons carry the same classes
// and data attributes as the grid cards, so the persisted handlers in
// src/social-wire.js and src/main.js (attachReelsActions, syncCounts, saved
// markers) keep working unchanged inside the overlay.
(function () {
  'use strict';

  // main.js declares these globals — reference them, never redeclare:
  // DB, SOC, profile, escapeHtml, safeAvatar, fallbackAvatar, displayUser,
  // verifiedBolt, reelIcon, mediaKeyOf, fmtCount, isFollowing, setFollowing,
  // attachReelsActions, markSavedReels, getGlitchVideos, pauseGlitchVideo,
  // updateGlitchPlayback, glitchToast, isGuest, showGuestGate.

  const SOUND_KEY = 'glitchit.reels.sound.v1';

  let viewer = null; // overlay root (#reel-viewer)
  let track = null; // snap-scroll container
  let slides = []; // [{ root, video, key }]
  let currentIndex = -1;
  let soundOn = false;
  let scrollTicking = false;

  const readSound = () => {
    try { return localStorage.getItem(SOUND_KEY) === '1'; } catch (e) { return false; }
  };
  const writeSound = (on) => {
    try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  };

  // ---------- Entry points (capture phase, so card toggles never double-fire) ----------
  document.addEventListener('click', (event) => {
    const target = event.target;
    // Never re-open the viewer from taps inside the viewer itself. Guests
    // tapping the reply bar get the sign-in gate (the rail buttons are already
    // gated by main.js's GUEST_GATED_SELECTOR).
    if (viewer && viewer.contains(target)) {
      if (target.closest('.rv-reply') && isGuest()) {
        event.preventDefault();
        event.stopPropagation();
        showGuestGate('Sign in to like, comment, follow, share & post');
      }
      return;
    }

    // Search Reels thumbnails are links we deliberately hijack.
    const thumb = target.closest('.sr-thumb[data-sr-kind="reels"]');
    if (thumb) {
      event.preventDefault();
      event.stopPropagation();
      openFromSearch(thumb);
      return;
    }

    // Everything else: only bare taps on media open the viewer — buttons,
    // links and forms keep their own handlers (pause, sound, like, follow…).
    if (target.closest('button, a, form, input, textarea, select, label')) return;

    const card = target.closest('.video-card');
    if (card) {
      event.preventDefault();
      event.stopPropagation();
      openFromCards(card);
      return;
    }
    const tile = target.closest('.profile-tile[data-reel="true"]');
    if (tile) {
      event.preventDefault();
      event.stopPropagation();
      openFromTiles(tile);
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!viewer) return;
    if (event.key === 'Escape') { closeViewer(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); go(currentIndex + 1); }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); go(currentIndex - 1); }
  });

  // ---------- Video list sources ----------

  // Glitches + Shop: the reel cards already rendered on the page.
  function openFromCards(startCard) {
    const cards = [...document.querySelectorAll('.video-card')];
    const start = Math.max(0, cards.indexOf(startCard));
    const list = cards.map((card) => {
      const vid = card.querySelector('video');
      const likeBtn = card.querySelector('.reel-like');
      const commentBtn = card.querySelector('.reel-comment');
      return {
        id: card.dataset.mediaKey || '',
        url: vid ? vid.getAttribute('src') || '' : '',
        poster: vid ? vid.getAttribute('poster') || '' : '',
        title: vid ? vid.getAttribute('aria-label') || '' : '',
        caption: card.querySelector('.reel-meta p')?.textContent?.trim() || '',
        user: card.querySelector('.reel-meta strong')?.textContent?.trim() || 'Creator',
        avatar: card.querySelector('.reel-creator img')?.getAttribute('src') || '',
        owner: card.dataset.owner || '',
        verified: Boolean(card.querySelector('.verified-bolt-inline')),
        likes: likeBtn ? Number(likeBtn.dataset.baseCount) || 0 : 0,
        comments: commentBtn ? Number(commentBtn.dataset.baseCount) || 0 : 0,
        shares: 0,
        saved: Boolean(card.querySelector('.reel-save.saved')),
      };
    }).filter((v) => v.url);
    openViewer(list, start);
  }

  // Search: the reel thumbnails currently rendered in the Reels grid.
  function openFromSearch(thumb) {
    const grid = document.getElementById('sr-reels-grid');
    const thumbs = grid ? [...grid.querySelectorAll('.sr-thumb[data-sr-kind="reels"]')] : [thumb];
    const start = Math.max(0, thumbs.indexOf(thumb));
    const list = thumbs.map((t) => ({
      id: t.dataset.reelId || '',
      url: t.dataset.reelUrl || '',
      poster: t.dataset.reelPoster || '',
      title: t.dataset.reelTitle || '',
      caption: t.dataset.reelCaption || '',
      user: t.dataset.reelHandle || t.dataset.reelUser || 'Creator',
      avatar: t.dataset.reelAvatar || '',
      owner: t.dataset.reelUser || '',
      verified: t.dataset.reelVerified === '1',
      likes: Number(t.dataset.reelLikes) || 0,
      comments: Number(t.dataset.reelComments) || 0,
      shares: Number(t.dataset.reelShares) || 0,
    })).filter((v) => v.url);
    openViewer(list, start);
  }

  // Profile + User: the reel tiles currently rendered in the grid.
  function openFromTiles(tile) {
    const grid = tile.closest('.profile-grid, #user-grid');
    const tiles = grid ? [...grid.querySelectorAll('.profile-tile[data-reel="true"]')] : [tile];
    const start = Math.max(0, tiles.indexOf(tile));
    const list = tiles.map((t) => ({
      id: t.dataset.reelId || '',
      url: t.dataset.reelUrl || '',
      poster: t.dataset.reelPoster || '',
      title: t.dataset.reelTitle || '',
      caption: t.dataset.reelCaption || '',
      user: t.dataset.reelHandle || t.dataset.reelUser || 'Creator',
      avatar: t.dataset.reelAvatar || '',
      owner: t.dataset.reelUser || '',
      verified: t.dataset.reelVerified === '1',
      likes: Number(t.dataset.reelLikes) || 0,
      comments: Number(t.dataset.reelComments) || 0,
      shares: Number(t.dataset.reelShares) || 0,
    })).filter((v) => v.url);
    openViewer(list, start);
  }

  // ---------- Viewer ----------

  function openViewer(list, startIndex) {
    if (!list.length) return;
    if (viewer) { go(startIndex, false); return; }

    soundOn = readSound();
    viewer = document.createElement('div');
    viewer.id = 'reel-viewer';
    viewer.className = 'reel-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Glitch viewer');
    viewer.innerHTML = `
      <header class="rv-head">
        <span class="rv-brand"><span class="rv-logo" aria-hidden="true">ϟ</span>Glitches<span class="rv-count" hidden></span></span>
        <span class="rv-head-actions">
          <button type="button" class="rv-sound" aria-label="${soundOn ? 'Mute' : 'Unmute'}">${soundOn ? '🔊' : '🔇'}</button>
          <button type="button" class="rv-close" aria-label="Close viewer">✕</button>
        </span>
      </header>
      <div class="rv-track" tabindex="-1"></div>
      <div class="rv-hint" aria-hidden="true">Swipe up · down</div>
      <div class="home-indicator" aria-hidden="true"></div>`;
    document.body.appendChild(viewer);

    track = viewer.querySelector('.rv-track');
    slides = list.map((v) => makeSlide(v));
    track.append(...slides.map((s) => s.root));

    track.addEventListener('scroll', onTrackScroll, { passive: true });
    viewer.querySelector('.rv-close').addEventListener('click', closeViewer);
    viewer.querySelector('.rv-sound').addEventListener('click', () => setSound(!soundOn));

    // Pause the feed behind the overlay so only the viewer plays.
    getGlitchVideos().forEach((v) => pauseGlitchVideo(v, true));
    document.body.classList.add('reel-viewer-open');

    // Bind the persisted follow/save handlers and mark already-saved reels;
    // like/comment counts + hearts sync through social-wire's observer.
    attachReelsActions();
    markSavedReels();

    const countEl = viewer.querySelector('.rv-count');
    if (countEl) {
      countEl.hidden = slides.length < 2;
      countEl.textContent = `1 / ${slides.length}`;
    }
    go(startIndex, false);
  }

  function makeSlide(v) {
    const key = mediaKeyOf(v);
    const me = window.GLITCHIT_USER;
    const myId = me && !me.guest ? me.id : '';
    const self = Boolean(v.owner && myId && String(v.owner) === String(myId));
    const name = escapeHtml(v.user || 'Creator');
    const avatar = safeAvatar(v.avatar) || fallbackAvatar(v.user || 'G');
    const bolt = v.verified ? verifiedBolt('verified-bolt-inline') : '';
    const avatarBolt = v.verified ? verifiedBolt() : '';
    const baseLikes = Number(v.likes) || 0;
    const baseComments = Number(v.comments) || 0;
    const likes = SOC ? SOC.totalLikes(key, baseLikes) : baseLikes;
    const comments = SOC ? SOC.totalComments(key, baseComments) : baseComments;
    const savedClass = v.saved ? ' saved' : '';
    const follow = self ? '' : '<button type="button" class="reel-follow rv-follow">Follow</button>';

    const root = document.createElement('article');
    root.className = 'video-card rv-slide' + (self ? ' rv-self' : '');
    root.dataset.owner = v.owner || '';
    root.dataset.mediaKey = key;
    root.innerHTML = `
      <video class="rv-video" src="${escapeHtml(v.url)}" poster="${escapeHtml(v.poster || '')}" muted loop playsinline preload="metadata" aria-label="${escapeHtml(v.title || 'Glitch')}"></video>
      <div class="rv-scrim" aria-hidden="true"></div>
      <div class="rv-bottom">
        <div class="reel-creator rv-creator">
          <span class="verified-avatar-wrap"><img src="${avatar}" alt="${name} avatar">${avatarBolt}</span>
          <div class="reel-meta"><strong>${name}${bolt}</strong><p>${escapeHtml(v.caption || '')}</p></div>
          ${follow}
        </div>
        <div class="rv-audio"><span class="reel-disc" aria-hidden="true"><i>♪</i></span><span class="rv-audio-label">Original audio · ${name}</span></div>
      </div>
      <div class="reel-rail rv-rail">
        <button type="button" class="reel-action reel-like rv-act" data-media-key="${escapeHtml(key)}" data-base-count="${baseLikes}" aria-label="Like this glitch">${reelIcon('heart')}<b>${fmtCount(likes)}</b></button>
        <button type="button" class="reel-action reel-comment rv-act" data-media-key="${escapeHtml(key)}" data-base-count="${baseComments}" aria-label="Comment on this glitch">${reelIcon('comment')}<b>${fmtCount(comments)}</b></button>
        <button type="button" class="reel-action reel-share rv-act" aria-label="Share this glitch">${reelIcon('send')}<b>Share</b></button>
        <span class="reel-disc rv-disc-sm" aria-hidden="true"><i>♪</i></span>
        <button type="button" class="reel-action reel-save rv-act${savedClass}" data-video-id="${escapeHtml(v.id || '')}" aria-label="${v.saved ? 'Unsave' : 'Save'} this glitch">${reelIcon('bookmark')}</button>
      </div>
      <button type="button" class="rv-reply reel-comment" data-media-key="${escapeHtml(key)}" data-base-count="${baseComments}" aria-label="Reply to ${name}">Reply to ${name}…<span class="rv-reply-emojis" aria-hidden="true"><i>😂</i><i>🔥</i><i>😍</i><b>♥</b></span></button>`;

    const video = root.querySelector('video');
    video.muted = !soundOn;
    video.dataset.playing = 'false';
    // Tap the media itself to pause/resume (rail + reply controls stay their own).
    root.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      const playing = video.dataset.playing === 'true';
      if (playing) pauseVideo(video);
      else playVideo(video);
    });

    return { root, video, key };
  }

  function playVideo(video) {
    if (!video || video.dataset.playing === 'true') return;
    video.dataset.playing = 'true';
    video.muted = !soundOn;
    const p = video.play();
    if (p && p.catch) p.catch(() => { video.dataset.playing = 'false'; });
  }

  function pauseVideo(video) {
    if (!video || video.dataset.playing === 'false') return;
    video.dataset.playing = 'false';
    try { video.pause(); } catch (e) { /* ignore */ }
  }

  function playSlide(i) {
    if (!viewer || i < 0 || i >= slides.length) return;
    currentIndex = i;
    slides.forEach((s, idx) => {
      s.root.classList.toggle('active', idx === i);
      if (idx === i) playVideo(s.video);
      else pauseVideo(s.video);
    });
    const countEl = viewer.querySelector('.rv-count');
    if (countEl && !countEl.hidden) countEl.textContent = `${i + 1} / ${slides.length}`;
  }

  function go(i, smooth = true) {
    if (!viewer || i < 0 || i >= slides.length) return;
    playSlide(i);
    const el = slides[i].root;
    const top = el.offsetTop - track.offsetTop;
    try {
      track.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    } catch (e) {
      track.scrollTop = top;
    }
  }

  function onTrackScroll() {
    if (scrollTicking || !viewer) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      if (!viewer) return;
      const rect = track.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let best = -1;
      let bestDist = Infinity;
      slides.forEach((s, i) => {
        const r = s.root.getBoundingClientRect();
        const c = r.top + r.height / 2;
        const d = Math.abs(c - mid);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best !== -1 && best !== currentIndex) playSlide(best);
    });
  }

  function setSound(on) {
    soundOn = on;
    writeSound(on);
    const btn = viewer && viewer.querySelector('.rv-sound');
    if (btn) {
      btn.textContent = on ? '🔊' : '🔇';
      btn.setAttribute('aria-label', on ? 'Mute' : 'Unmute');
    }
    slides.forEach((s) => { s.video.muted = !on; });
    if (on && slides[currentIndex]) playVideo(slides[currentIndex].video);
  }

  function closeViewer() {
    if (!viewer) return;
    slides.forEach((s) => pauseVideo(s.video));
    viewer.remove();
    viewer = null;
    track = null;
    slides = [];
    currentIndex = -1;
    document.body.classList.remove('reel-viewer-open');
    // Hand playback back to the feed (glitches + shop autoplay).
    updateGlitchPlayback();
  }
})();
