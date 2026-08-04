// GlitchIt — shared multi-page app script.
// Every screen lives in its own HTML file (index, search, glitches, messages, activity,
// create, profile, shop). This script detects the current page via <body data-page="...">
// and hydrates only the interactions that page needs. Uploads and theme are persisted
// in localStorage so state carries over when you move between pages.

const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;

const profile = {
  username: 'b3ice_drage',
  name: 'ßrįæñ',
  avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=240&q=80',
};

const page = document.body.dataset.page || 'home';

// ---------- Shared state (persisted across pages) ----------
const UPLOADS_KEY = 'glitchit.uploads.v1';
const THEME_KEY = 'glitchit.theme';
let userUploads = { feed: [], stories: [], videos: [] };
try {
  const saved = JSON.parse(localStorage.getItem(UPLOADS_KEY) || 'null');
  if (saved && saved.feed && saved.stories && saved.videos) userUploads = saved;
} catch (e) { /* corrupted storage — start fresh */ }

function saveUploads() {
  try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(userUploads)); } catch (e) { /* storage unavailable */ }
}

// ---------- Upload cards ----------
function uploadCard(item, type) {
  const isVideo = type === 'videos' || item.type === 'video';
  if (isVideo) return glitchVideoCard({ ...item, user: profile.username, avatar: profile.avatar, src: item.src || item.preview, poster: item.preview, caption: item.caption || item.title }, true);
  return `<article class="post upload-card"><header><div class="profile"><img src="${profile.avatar}" alt="${profile.username} avatar"><div><strong>${profile.username}</strong><span>Fresh post</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${item.preview}" alt="${item.title}"><span class="shop-badge">${icon('＋')} ${item.type}</span></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>New upload</strong><p><b>${profile.username}</b> ${item.caption || item.title}</p></article>`;
}

function glitchVideoCard(video, uploaded = false) {
  return `<article class="video-card ${uploaded ? 'upload-card' : ''}"><video class="glitch-video" playsinline loop preload="metadata" poster="${video.poster || ''}" src="${video.src}" aria-label="${video.title}"></video><button type="button" class="video-toggle" aria-label="Pause ${video.title}">${icon('Ⅱ')}</button><button type="button" class="sound-toggle" aria-label="Mute ${video.title}">${icon('🔊')}</button><div class="video-overlay"><div class="profile"><img src="${video.avatar}" alt="${video.user} avatar"><div><strong>${video.user}</strong><span>${video.title}</span></div></div><p>${video.caption}</p><a class="shop-badge" href="shop.html">${icon('◒')} Tagged products</a></div></article>`;
}

function renderUploads(type) {
  return userUploads[type].map((item) => uploadCard(item, type)).join('');
}

// ---------- Stories ----------
function attachStoryLinks() {
  document.querySelectorAll('.story[data-story-name]').forEach((storyLink) => {
    storyLink.addEventListener('click', (event) => {
      event.preventDefault();
      const name = storyLink.dataset.storyName;
      const image = storyLink.dataset.storyImage;
      const live = storyLink.dataset.storyLive === 'true';
      document.getElementById('story-viewer')?.remove();
      document.body.insertAdjacentHTML('beforeend', `<div class="story-viewer" id="story-viewer" role="dialog" aria-modal="true" aria-label="${name} story"><button type="button" class="story-close" aria-label="Close story">×</button><div><img src="${image}" alt="${name} story"><span>${live ? 'Live now' : 'Story'}</span><h2>${name}</h2><p>Tap through creator updates, product teasers, and behind-the-scenes moments.</p><a class="primary-action" href="profile.html">View profile</a></div></div>`);
      document.querySelector('.story-close')?.focus();
    });
  });
  document.addEventListener('click', (event) => {
    if (event.target.matches('.story-viewer, .story-close')) document.getElementById('story-viewer')?.remove();
  });
}

function hydrateStoryShelf() {
  const shelf = document.querySelector('.stories');
  if (!shelf) return;
  const insertPoint = shelf.children[1] || null;
  [...userUploads.stories].reverse().forEach((story) => {
    const link = document.createElement('a');
    link.className = 'story';
    link.href = '#';
    link.dataset.storyName = story.title;
    link.dataset.storyImage = story.preview;
    link.dataset.storyLive = 'true';
    link.setAttribute('aria-label', `Open ${story.title}'s story`);
    link.innerHTML = `<span class="story-ring live"><img src="${story.preview}" alt="${story.title} avatar"></span><span>${story.title}</span>`;
    shelf.insertBefore(link, insertPoint);
  });
  attachStoryLinks();
}

// ---------- Create page (Instagram-style studio) ----------
const CREATE_SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const CREATE_SAMPLE_IMAGE = 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=80';
const CREATE_FILTERS = {
  none: { filter: 'none', fx: '' },
  clarendon: { filter: 'contrast(1.22) saturate(1.35)', fx: '' },
  gingham: { filter: 'contrast(1.08) brightness(1.1) sepia(.16)', fx: '' },
  moon: { filter: 'grayscale(1) contrast(1.14) brightness(.94)', fx: '' },
  lark: { filter: 'brightness(1.09) contrast(.92) saturate(.9) sepia(.12)', fx: '' },
  reyes: { filter: 'sepia(.24) brightness(1.06) contrast(.9) saturate(.72)', fx: '' },
  juno: { filter: 'saturate(1.5) contrast(1.06) brightness(1.12)', fx: '' },
  slumber: { filter: 'saturate(.78) brightness(1.12) contrast(.88) hue-rotate(-6deg)', fx: '' },
  crema: { filter: 'sepia(.38) contrast(.94) brightness(1.06)', fx: '' },
  ludwig: { filter: 'saturate(1.18) contrast(1.06) brightness(1.06)', fx: '' },
  aden: { filter: 'brightness(1.1) saturate(.85) contrast(.94) hue-rotate(-10deg)', fx: '' },
  perpetua: { filter: 'contrast(1.08) brightness(1.1) saturate(1.1)', fx: '' },
  glitch: { filter: 'contrast(1.3) saturate(1.5) hue-rotate(-8deg)', fx: 'fx-glitch' },
  vhs: { filter: 'saturate(1.35) contrast(1.15)', fx: 'fx-vhs' },
  neon: { filter: 'saturate(1.9) contrast(1.25)', fx: 'fx-neon' },
};

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function attachCreateStudio() {
  const form = document.getElementById('create-form');
  const stage = document.getElementById('create-stage');
  if (!form || !stage) return;
  const video = document.getElementById('camera-feed');
  const photo = document.getElementById('stage-photo');
  const fallback = document.getElementById('stage-fallback');
  const fxLayer = document.getElementById('stage-fx');
  const nextBtn = document.getElementById('create-next');
  const backBtn = document.getElementById('create-back');
  const status = document.getElementById('create-status');
  const tabs = [...document.querySelectorAll('.create-tab')];
  const chips = [...document.querySelectorAll('.filter-chip')];
  const mediaTiles = [...document.querySelectorAll('.media-tile')];
  const tools = document.querySelector('.create-tools');

  const micBtn = document.getElementById('mic-btn');
  const state = { type: 'feed', filter: 'none', captured: null, mode: 'camera', stream: null, hadCamera: false, facing: 'user', torch: false, mic: false, hasMic: false };

  const updateMicButton = () => {
    if (!micBtn) return;
    micBtn.textContent = state.mic ? '🎤' : '🔇';
    micBtn.setAttribute('aria-label', state.mic ? 'Mute microphone' : 'Unmute microphone');
  };

  const setMode = (mode) => {
    state.mode = mode;
    video.hidden = mode !== 'camera';
    photo.hidden = mode !== 'photo';
    document.getElementById('flip-btn').hidden = mode !== 'camera';
    document.getElementById('flash-btn').hidden = mode !== 'camera';
    document.getElementById('capture-btn').hidden = mode !== 'camera';
    if (micBtn) micBtn.hidden = mode !== 'camera' || !state.hasMic;
    nextBtn.hidden = mode !== 'photo';
    applyFilter();
  };

  const stopCamera = () => {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    video.srcObject = null;
  };

  const startCamera = async (facingMode = state.facing) => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      fallback.hidden = false;
      return;
    }
    const videoConstraints = { facingMode, width: { ideal: 1280 } };
    let stream = null;
    try {
      // Request microphone + camera preview together
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    } catch (err) {
      // Mic denied or missing — fall back to camera-only preview
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      } catch (err2) {
        fallback.hidden = false;
        setMode('camera');
        return;
      }
    }
    state.stream = stream;
    state.hadCamera = true;
    video.srcObject = stream;
    state.hasMic = stream.getAudioTracks().length > 0;
    state.mic = state.hasMic;
    video.muted = !state.hasMic;
    updateMicButton();
    fallback.hidden = true;
    setMode('camera');
  };

  const setPhoto = (src) => {
    photo.src = src;
    fallback.hidden = true;
    state.captured = src;
    setMode('photo');
  };

  const applyFilter = () => {
    const def = CREATE_FILTERS[state.filter] || CREATE_FILTERS.none;
    [video, photo].forEach((el) => { if (!el.hidden) el.style.filter = def.filter; });
    fxLayer.className = `stage-fx ${def.fx}`.trim();
  };

  const resetStudio = () => {
    form.hidden = true;
    stage.hidden = false;
    tools.hidden = false;
    tabs[0].parentElement.hidden = false;
    state.captured = null;
    document.getElementById('stage-captured').hidden = true;
    setMode('camera');
    if (state.hadCamera) startCamera();
  };

  // Tabs (Feed / Story / Video)
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
      state.type = tab.dataset.tab;
      if (status) status.textContent = '';
    });
  });

  // Filter chips — previews + live application
  chips.forEach((chip) => {
    chip.querySelector('.chip-thumb').style.filter = (CREATE_FILTERS[chip.dataset.filter] || CREATE_FILTERS.none).filter;
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.toggle('active', c === chip));
      state.filter = chip.dataset.filter;
      applyFilter();
    });
  });

  // Media source tiles
  document.getElementById('media-camera').addEventListener('click', () => {
    mediaTiles.forEach((t) => t.classList.toggle('active', t.id === 'media-camera'));
    startCamera();
  });
  document.querySelectorAll('.media-sample').forEach((tile) => {
    tile.addEventListener('click', () => {
      mediaTiles.forEach((t) => t.classList.toggle('active', t === tile));
      setPhoto(tile.dataset.media);
    });
  });
  const uploadInput = document.getElementById('media-upload-input');
  uploadInput?.addEventListener('change', async () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    const src = await readFileAsDataURL(file);
    if (src) {
      mediaTiles.forEach((t) => t.classList.remove('active'));
      setPhoto(src);
    }
    uploadInput.value = '';
  });

  // Shutter: capture the camera frame
  document.getElementById('capture-btn').addEventListener('click', () => {
    if (!state.stream) { fallback.hidden = false; return; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth || 1280, 1280);
    canvas.height = Math.min(video.videoHeight || 960, 1280);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    setPhoto(dataUrl);
    document.getElementById('stage-captured').hidden = false;
  });

  // Flip camera
  document.getElementById('flip-btn').addEventListener('click', () => {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    startCamera();
  });

  // Microphone preview toggle
  micBtn?.addEventListener('click', () => {
    state.mic = !state.mic;
    video.muted = !state.mic;
    updateMicButton();
  });

  // Flash: hardware torch where supported, white flash otherwise
  document.getElementById('flash-btn').addEventListener('click', async () => {
    const track = state.stream?.getVideoTracks?.()[0];
    try {
      if (track?.applyConstraints) {
        state.torch = !state.torch;
        await track.applyConstraints({ advanced: [{ torch: state.torch }] });
      } else {
        throw new Error('no torch');
      }
    } catch (err) {
      stage.classList.add('stage-flashing');
      setTimeout(() => stage.classList.remove('stage-flashing'), 180);
    }
  });

  // Next → caption form
  nextBtn?.addEventListener('click', () => {
    if (!state.captured) return;
    document.getElementById('create-preview-thumb').src = state.captured;
    document.getElementById('create-form-head-label').textContent = state.type === 'videos' ? 'New video' : state.type === 'stories' ? 'New story' : 'New post';
    stage.hidden = true;
    tools.hidden = true;
    tabs[0].parentElement.hidden = true;
    nextBtn.hidden = true;
    form.hidden = false;
    form.querySelector('[name="title"]').focus();
  });

  // Back to camera
  backBtn?.addEventListener('click', () => {
    stage.hidden = false;
    tools.hidden = false;
    tabs[0].parentElement.hidden = false;
    form.hidden = true;
    if (status) status.textContent = '';
  });

  // Publish
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = data.get('title') || 'Untitled upload';
    const caption = data.get('caption');
    const type = state.type;
    const isVideo = type === 'videos';
    let preview = state.captured;
    const file = data.get('media');
    if (!preview && file?.size) preview = await readFileAsDataURL(file);
    if (!preview) preview = isVideo ? CREATE_SAMPLE_VIDEO : CREATE_SAMPLE_IMAGE;
    const item = { title, caption, preview, type: isVideo ? 'video' : type };
    if (isVideo && preview !== CREATE_SAMPLE_VIDEO) item.src = CREATE_SAMPLE_VIDEO;
    userUploads[type].unshift(item);
    saveUploads();
    if (status) status.textContent = `Published to ${isVideo ? 'Glitches' : type}. View it on ${isVideo ? 'the Glitches page' : 'the Home feed'}.`;
    form.reset();
    resetStudio();
  });

  window.addEventListener('pagehide', stopCamera);
  startCamera();
}

// ---------- Profile settings ----------
function attachSettingsDrawer() {
  document.querySelectorAll('.settings-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      document.body.classList.toggle('settings-open');
    });
  });
  document.addEventListener('click', (event) => {
    if (document.body.classList.contains('settings-open') && event.target.matches('.settings-backdrop, .settings-close')) document.body.classList.remove('settings-open');
  });
}

function attachThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.dataset.theme = saved;
  toggle.checked = saved === 'dark';
  toggle.addEventListener('change', () => {
    const theme = toggle.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  });
}

// ---------- Shop page ----------
function attachShopFilters() {
  const search = document.getElementById('shop-search');
  const category = document.getElementById('category-filter');
  if (!search || !category) return;
  const cards = [...document.querySelectorAll('.product')];
  const filter = () => {
    const term = search.value.trim().toLowerCase();
    const selected = category.value;
    cards.forEach((card) => {
      const matchesTerm = card.dataset.title.includes(term) || card.dataset.seller.includes(term);
      const matchesCategory = selected === 'all' || card.dataset.category === selected;
      card.hidden = !(matchesTerm && matchesCategory);
    });
  };
  search.addEventListener('input', filter);
  category.addEventListener('change', filter);
  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    search.value = q;
    filter();
  }
}

// ---------- Search page ----------
function attachSearchForm() {
  const form = document.getElementById('search-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = document.getElementById('search-input').value.trim();
    if (term) location.href = `shop.html?q=${encodeURIComponent(term)}`;
  });
}

// ---------- End-of-page animated toast ----------
let endToastTimer = null;
let lastEndToastAt = 0;

function showEndOfUpdates() {
  const now = Date.now();
  if (now - lastEndToastAt < 3000) return;
  lastEndToastAt = now;
  let toast = document.getElementById('end-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'end-toast';
    toast.className = 'end-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="end-toast-mark">${icon('ϟ')}</span><span class="end-toast-text">You've seen all updates</span>`;
  toast.classList.remove('show');
  void toast.offsetWidth; // restart the animation
  toast.classList.add('show');
  clearTimeout(endToastTimer);
  endToastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 12;
}

function checkEndOfPage() {
  const pageSection = document.querySelector('[data-page]');
  if (!pageSection) return;
  const reel = document.getElementById('glitches-reel');
  const mainEl = document.querySelector('main');
  if (pageSection.id === 'glitches' && reel && isNearBottom(reel)) {
    showEndOfUpdates();
  } else if (mainEl && isNearBottom(mainEl)) {
    showEndOfUpdates();
  }
}

function attachEndOfPageDetection() {
  document.querySelector('main')?.addEventListener('scroll', checkEndOfPage, { passive: true });
  document.getElementById('glitches-reel')?.addEventListener('scroll', checkEndOfPage, { passive: true });
}

// ---------- Glitches playback (audio + video autoplay) ----------
let glitchSoundUnmuted = true;

function unmuteAllGlitchVideos(unmute) {
  glitchSoundUnmuted = unmute;
  getGlitchVideos().forEach((video) => {
    video.muted = !unmute;
    video.dataset.userUnmuted = unmute ? 'true' : 'false';
    const btn = video.closest('.video-card')?.querySelector('.sound-toggle');
    if (btn) {
      btn.replaceChildren(document.createRange().createContextualFragment(icon(unmute ? '🔊' : '🔇')));
      btn.setAttribute('aria-label', unmute ? `Mute ${video.getAttribute('aria-label') || 'video'}` : `Unmute ${video.getAttribute('aria-label') || 'video'}`);
    }
  });
}

function getGlitchVideos() {
  return [...document.querySelectorAll('.glitch-video')];
}

function pauseGlitchVideo(video) {
  video.pause();
  const card = video.closest('.video-card');
  card?.querySelector('.video-toggle')?.replaceChildren(document.createRange().createContextualFragment(icon('▶')));
}

function playGlitchVideo(video) {
  if (video.dataset.userPaused === 'true') return;
  getGlitchVideos().forEach((otherVideo) => {
    if (otherVideo !== video) pauseGlitchVideo(otherVideo);
  });
  video.play().catch(() => pauseGlitchVideo(video));
  const card = video.closest('.video-card');
  card?.querySelector('.video-toggle')?.replaceChildren(document.createRange().createContextualFragment(icon('Ⅱ')));
}

function updateGlitchPlayback() {
  const reel = document.getElementById('glitches-reel');
  if (!reel) {
    getGlitchVideos().forEach(pauseGlitchVideo);
    return;
  }
  const mostVisible = getGlitchVideos().map((video) => {
    const rect = video.getBoundingClientRect();
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return { video, visible };
  }).filter(({ visible }) => visible > 0).sort((a, b) => b.visible - a.visible)[0]?.video;
  if (mostVisible) playGlitchVideo(mostVisible);
}

function attachGlitchAutoplay() {
  getGlitchVideos().forEach((video) => {
    if (video.dataset.autoplayReady) return;
    video.dataset.autoplayReady = 'true';
    // Sync each new video with the global sound state
    video.muted = !glitchSoundUnmuted;
    video.dataset.userUnmuted = glitchSoundUnmuted ? 'true' : 'false';
    video.addEventListener('click', () => {
      video.dataset.userPaused = video.paused ? 'false' : 'true';
      video.paused ? playGlitchVideo(video) : pauseGlitchVideo(video);
    });
    video.closest('.video-card')?.querySelector('.video-toggle')?.addEventListener('click', () => {
      video.dataset.userPaused = video.paused ? 'false' : 'true';
      video.paused ? playGlitchVideo(video) : pauseGlitchVideo(video);
    });
    // Sound toggle: toggles sound for ALL videos
    const soundBtn = video.closest('.video-card')?.querySelector('.sound-toggle');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unmuteAllGlitchVideos(!glitchSoundUnmuted);
        // Ensure the current video is playing when sound is toggled
        if (video.paused) {
          video.dataset.userPaused = 'false';
          playGlitchVideo(video);
        }
      });
    }
  });
  const reel = document.getElementById('glitches-reel');
  if (reel && !reel.dataset.scrollReady) {
    reel.dataset.scrollReady = 'true';
    reel.addEventListener('scroll', updateGlitchPlayback, { passive: true });
  }
  updateGlitchPlayback();
}

// ---------- Splash screen (once per session) ----------
const SPLASH_KEY = 'glitchit.splash.v1';

function showSplashScreen() {
  const splash = document.createElement('div');
  splash.id = 'splash';
  splash.className = 'splash';
  splash.setAttribute('aria-hidden', 'true');
  splash.innerHTML = `<div class="splash-inner"><span class="splash-mark">ϟ</span><h1 class="splash-title">GlitchIt</h1><p class="splash-tag">Create · Drop · Glitch</p><div class="splash-bar"><i></i></div></div>`;
  document.body.prepend(splash);
  document.body.classList.add('splash-active');
  const dismiss = () => {
    splash.classList.add('done');
    document.body.classList.remove('splash-active');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 700); // fallback
  };
  setTimeout(dismiss, 4000);
}

try {
  if (!sessionStorage.getItem(SPLASH_KEY)) {
    sessionStorage.setItem(SPLASH_KEY, '1');
    showSplashScreen();
  }
} catch (e) { /* sessionStorage unavailable — skip splash */ }

// ---------- Page dispatch ----------
attachThemeToggle();
attachEndOfPageDetection();

if (page === 'home') {
  const feedTarget = document.getElementById('upload-feed');
  if (feedTarget) feedTarget.innerHTML = renderUploads('feed');
  hydrateStoryShelf();
}
if (page === 'glitches') {
  const videoTarget = document.getElementById('video-feed');
  if (videoTarget) videoTarget.innerHTML = renderUploads('videos');
  attachGlitchAutoplay();
}
if (page === 'create') attachCreateStudio();
if (page === 'profile') attachSettingsDrawer();
if (page === 'shop') attachShopFilters();
if (page === 'search') attachSearchForm();

window.addEventListener('scroll', updateGlitchPlayback, { passive: true });
