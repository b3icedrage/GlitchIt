// GlitchIt — shared multi-page app script.
// Every screen lives in its own HTML file (index, search, glitches, messages, activity,
// create, profile, shop). This script detects the current page via <body data-page="...">
// and hydrates only the interactions that page needs. Uploads and theme are persisted
// in localStorage so state carries over when you move between pages.

const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;

// Instagram-Reels style line icons (heart / comment / send) used on glitch cards.
const reelIcon = (kind) => kind === 'heart'
  ? '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
  : kind === 'comment'
  ? '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  : kind === 'bookmark'
  ? '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
  : '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 22-7z"/></svg>';

const profile = {
  username: 'b3ice_drage',
  name: 'ßrįæñ',
  avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=240&q=80',
};

// Map a stored owner UUID back to a friendly handle for display.
function displayUser(owner) {
  const u = window.GLITCHIT_USER;
  if (u && owner === u.id) return u.user_metadata?.username || u.email?.split('@')[0] || owner;
  return owner || '';
}

const page = document.body.dataset.page || 'home';

function returnToPage() {
  try { return new URLSearchParams(location.search).get('returnTo') || ''; } catch (e) { return ''; }
}

// ---------- Supabase database (optional — see src/config.js) ----------
// Loaded lazily so the app works identically when no keys are configured.
let DB = null;
import('./db.js?v=3').then((mod) => { DB = mod; }).catch(() => { DB = null; });

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
  const likes = video.likes || '1.2K';
  const comments = video.comments || '312';
  const shares = video.shares || '8.1K';
  const replyTo = video.replyTo || video.user;
  const savedClass = video.saved ? ' saved' : '';
  return `<article class="video-card reel-card ${uploaded ? 'upload-card' : ''}"><video class="glitch-video" playsinline loop preload="metadata" poster="${video.poster || ''}" src="${video.src}" aria-label="${video.title}"></video><button type="button" class="video-toggle" aria-label="Pause ${video.title}">${icon('Ⅱ')}</button><button type="button" class="sound-toggle" aria-label="Mute ${video.title}">${icon('🔊')}</button><div class="reel-rail"><button type="button" class="reel-action reel-like" aria-label="Like, ${likes} likes">${reelIcon('heart')}<b>${likes}</b></button><button type="button" class="reel-action" aria-label="Comment, ${comments} comments">${reelIcon('comment')}<b>${comments}</b></button><button type="button" class="reel-action" aria-label="Share, ${shares} shares">${reelIcon('send')}<b>${shares}</b></button><span class="reel-disc" aria-hidden="true"><i>♪</i></span><button type="button" class="reel-action reel-save${savedClass}" data-video-id="${video.id || ''}" aria-label="${video.saved ? 'Unsave' : 'Save'} ${video.title}">${reelIcon('bookmark')}</button></div><div class="video-overlay reel-overlay"><div class="reel-creator"><img src="${video.avatar}" alt="${video.user} avatar"><div class="reel-meta"><strong>${video.user}</strong><p>${video.caption}</p></div><button type="button" class="reel-follow">Follow</button></div><div class="reel-comment"><span>Reply to ${replyTo}'s Like…</span><span class="reel-emojis" aria-hidden="true"><i>😂</i><i>🔥</i><i>😍</i><b>♥</b></span></div></div></article>`;
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

// Edit-screen constants (adjustments, sticker emojis, text colors).
const ADJUST_KEYS = ['brightness', 'contrast', 'saturation', 'warmth'];
const ADJUST_LABELS = { brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', warmth: 'Warmth' };
const EMOJI_CHOICES = ['😀', '😂', '😍', '🔥', '✨', '👏', '🛍️', '💥', '😎', '🥰', '🤩', '🤯', '🎉', '💯', '🙌', '❤️', '💜', '💙', '⚡', '🌟', '🎧', '👟', '🧢', '📸'];
const TEXT_COLORS = ['#ffffff', '#ffd60a', '#ff3040', '#d62976', '#4f5bd5', '#30d158', '#000000'];

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
  const zoomBtn = document.getElementById('zoom-btn');
  const timerBtn = document.getElementById('timer-btn');
  const ratioBtn = document.getElementById('ratio-btn');
  const countdown = document.getElementById('stage-countdown');
  const hint = document.getElementById('stage-hint');
  const recPill = document.getElementById('rec-pill');
  const recTime = document.getElementById('rec-time');
  const stageVideo = document.getElementById('stage-video');
  const previewImg = document.getElementById('create-preview-thumb');
  const previewVideo = document.getElementById('create-preview-video');
  const draftsBtn = document.getElementById('drafts-btn');
  const draftsCount = document.getElementById('drafts-count');
  const saveDraftBtn = document.getElementById('save-draft-btn');
  const locationInput = document.getElementById('location-input');
  const shareRow = document.getElementById('share-row');
  const shareFeed = document.getElementById('share-to-feed');
  const flipBtn = document.getElementById('flip-btn');
  const flashBtn = document.getElementById('flash-btn');
  const thumb = document.getElementById('mode-thumb');
  const thumbOriginal = thumb?.querySelector('img')?.getAttribute('src') || '';
  const DRAFTS_KEY = 'glitchit.drafts.v1';
  let submitTimer = null;
  // Aspect ratios keyed to height/width (capture canvas height = width * ratio).
  const RATIOS = { '9:16': 16 / 9, '1:1': 1, '4:5': 5 / 4, '16:9': 9 / 16 };
  const RATIO_ORDER = ['9:16', '1:1', '4:5', '16:9'];
  const state = { type: 'feed', filter: 'none', captured: null, mode: 'camera', stream: null, hadCamera: false, facing: 'user', torch: false, mic: false, hasMic: false, grid: false, audience: 'you', zoom: 1, timer: 0, counting: false, editingDraft: -1, ratio: '9:16', canRecord: typeof MediaRecorder !== 'undefined', recording: false, recorder: null, chunks: [], recTimer: null, recStart: 0, recordedUrl: '', recordedBlob: null, keepUrl: false, edit: { brightness: 100, contrast: 100, saturation: 100, warmth: 0, rotate: 0, flipH: false, flipV: false, texts: [], emojis: [], trimStart: 0, trimEnd: Infinity, trimSet: false } };

  const updateMicButton = () => {
    if (!micBtn) return;
    micBtn.textContent = state.mic ? '🎤' : '🔇';
    micBtn.setAttribute('aria-label', state.mic ? 'Mute microphone' : 'Unmute microphone');
  };

  // Shutter/timer chrome reacts to the active tab (record mode + no timer for REELs).
  const updateModeChrome = () => {
    const capture = document.getElementById('capture-btn');
    const videoMode = state.type === 'videos';
    if (capture) {
      capture.classList.toggle('record', videoMode && state.canRecord);
      capture.setAttribute('aria-label', videoMode ? (state.recording ? 'Stop recording' : 'Record video') : 'Capture photo');
    }
    if (timerBtn) timerBtn.hidden = videoMode;
  };

  const setMode = (mode) => {
    state.mode = mode;
    video.hidden = mode !== 'camera';
    photo.hidden = mode !== 'photo';
    if (stageVideo) stageVideo.hidden = mode !== 'video';
    if (flipBtn) flipBtn.hidden = mode !== 'camera';
    if (flashBtn) flashBtn.hidden = mode !== 'camera';
    if (ratioBtn) ratioBtn.hidden = mode !== 'camera';
    document.getElementById('capture-btn').hidden = mode !== 'camera';
    if (micBtn) micBtn.hidden = mode !== 'camera' || !state.hasMic;
    nextBtn.hidden = mode !== 'photo' && mode !== 'video';
    if (hint) {
      hint.hidden = mode !== 'photo' && mode !== 'video';
      hint.textContent = mode === 'video' ? 'Tap video to retake' : 'Tap photo to retake';
    }
    updateDraftsBadge();
    applyFilter();
  };

  const stopCamera = () => {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    video.srcObject = null;
  };

  const startCamera = async (facingMode = state.facing) => {
    stopCamera();
    clearRecordingState();
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
    // Reset zoom and restore the gallery thumbnail when returning to the camera
    state.zoom = 1;
    video.style.transform = '';
    if (zoomBtn) zoomBtn.textContent = '1x';
    if (thumb && state.mode !== 'camera') thumb.querySelector('img').src = thumbOriginal;
    if (ratioBtn) ratioBtn.hidden = false;
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
    [video, photo, stageVideo].forEach((el) => { if (el && !el.hidden) el.style.filter = def.filter; });
    fxLayer.className = `stage-fx ${def.fx}`.trim();
    const label = document.getElementById('filter-label');
    if (label) {
      const show = state.filter !== 'none';
      label.textContent = state.filter;
      label.classList.toggle('show', show);
    }
  };

  const resetStudio = () => {
    form.hidden = true;
    stage.hidden = false;
    tools.hidden = false;
    tabs[0].parentElement.hidden = false;
    state.captured = null;
    clearRecordingState();
    document.getElementById('stage-captured').hidden = true;
    setMode('camera');
    if (state.hadCamera) startCamera();
  };

  // Tabs (POST / STORY / REEL / LIVE)
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (state.recording) { showStageToast('Stop the recording first'); return; }
      if (tab.dataset.tab === 'live') {
        location.href = 'live.html';
        return;
      }
      tabs.forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
      state.type = tab.dataset.tab;
      if (status) status.textContent = '';
      updateModeChrome();
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
  const grabUploadedPoster = () => {
    try {
      const c = document.createElement('canvas');
      c.width = stageVideo.videoWidth || 1080;
      c.height = stageVideo.videoHeight || 1920;
      c.getContext('2d').drawImage(stageVideo, 0, 0, c.width, c.height);
      if (c.toDataURL('image/jpeg', 0.8)) state.captured = c.toDataURL('image/jpeg', 0.8);
    } catch (e) { /* keep the fallback poster */ }
  };
  uploadInput?.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    if (file.type.startsWith('video/')) {
      // Uploaded videos use the same editor/publisher path as camera reels.
      // Switch the post type here too, otherwise a video uploaded from POST
      // would be treated as a photo when the user taps Next.
      if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
      const url = URL.createObjectURL(file);
      state.recordedUrl = url;
      state.recordedBlob = file;
      state.keepUrl = false;
      state.captured = CREATE_SAMPLE_IMAGE; // replaced with the first video frame below
      if (stageVideo) {
        stageVideo.onloadeddata = grabUploadedPoster;
        stageVideo.src = url;
        stageVideo.load();
      }
      tabs.forEach((tab) => {
        const active = tab.dataset.tab === 'videos';
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      state.type = 'videos';
      mediaTiles.forEach((t) => t.classList.remove('active'));
      setMode('video');
      document.getElementById('stage-captured').hidden = false;
      updateModeChrome();
      uploadInput.value = '';
      return;
    }
    readFileAsDataURL(file).then((src) => {
      if (src) {
        mediaTiles.forEach((t) => t.classList.remove('active'));
        setPhoto(src);
      }
      uploadInput.value = '';
    });
  });

  // Shutter: capture the camera frame (timer countdown supported)
  const capturePhoto = () => {
    if (!state.stream) { fallback.hidden = false; return; }
    const canvas = document.createElement('canvas');
    const ratio = RATIOS[state.ratio] || 1;
    canvas.width = 1080;
    canvas.height = Math.round(1080 * ratio);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    setPhoto(dataUrl);
    document.getElementById('stage-captured').hidden = false;
    // The bottom-left thumbnail now previews the shot (tap it to retake)
    if (thumb) thumb.querySelector('img').src = dataUrl;
    state.timer = 0;
    updateTimerButton();
  };

  // ---------- REEL video recording (MediaRecorder where supported) ----------
  const clearRecordingState = () => {
    if (state.recording && state.recorder) {
      try { state.recorder.stop(); } catch (e) { /* ignore */ }
    }
    state.recording = false;
    state.recorder = null;
    state.chunks = [];
    if (state.recTimer) { clearInterval(state.recTimer); state.recTimer = null; }
    if (recPill) recPill.hidden = true;
    const capture = document.getElementById('capture-btn');
    capture?.classList.remove('recording');
    if (state.recordedUrl) {
      // A published item may still reference this URL — keep it alive until retake.
      if (!state.keepUrl) URL.revokeObjectURL(state.recordedUrl);
      state.recordedUrl = '';
      state.keepUrl = false;
    }
    state.recordedBlob = null;
    if (stageVideo) { stageVideo.pause(); stageVideo.removeAttribute('src'); stageVideo.load(); }
    updateModeChrome();
  };

  const frameFromCamera = () => {
    try {
      const c = document.createElement('canvas');
      c.width = video.videoWidth || 1280;
      c.height = video.videoHeight || 720;
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    } catch (e) { return ''; }
  };

  const updateRecClock = () => {
    if (!recTime) return;
    const s = Math.max(0, Math.floor((Date.now() - state.recStart) / 1000));
    recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const pickRecorderMime = () => {
    const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* keep trying */ }
    }
    return '';
  };

  const startRecording = () => {
    if (!state.stream) { fallback.hidden = false; showStageToast('Camera is off — pick a photo instead'); return; }
    if (!state.canRecord) return;
    const mimeType = pickRecorderMime();
    try {
      const recorder = new MediaRecorder(state.stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 4e6 });
      state.recorder = recorder;
      state.chunks = [];
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) state.chunks.push(event.data); };
      recorder.onstop = () => finishRecording();
      recorder.start(250);
      state.recording = true;
      state.recStart = Date.now();
      if (recPill) recPill.hidden = false;
      const capture = document.getElementById('capture-btn');
      capture?.classList.add('recording');
      state.recTimer = setInterval(updateRecClock, 500);
      updateRecClock();
      if (zoomBtn) zoomBtn.hidden = true;
      if (flashBtn) flashBtn.hidden = true;
      if (micBtn) micBtn.hidden = true;
      showStageToast('Recording… tap again to stop');
    } catch (err) {
      showStageToast('Recording isn\u2019t supported on this device \u2014 took a photo instead');
      capturePhoto();
    }
  };

  const stopRecording = () => {
    if (!state.recorder) return;
    try { state.recorder.stop(); } catch (e) { /* ignore */ }
  };

  const finishRecording = () => {
    state.recording = false;
    state.recorder = null;
    if (state.recTimer) { clearInterval(state.recTimer); state.recTimer = null; }
    if (recPill) recPill.hidden = true;
    const capture = document.getElementById('capture-btn');
    capture?.classList.remove('recording');
    if (zoomBtn) zoomBtn.hidden = false;
    if (flashBtn) flashBtn.hidden = false;
    if (micBtn) micBtn.hidden = !state.hasMic;
    const blob = new Blob(state.chunks, { type: state.chunks[0]?.type || 'video/webm' });
    state.chunks = [];
    if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
    const url = URL.createObjectURL(blob);
    const poster = frameFromCamera() || '';
    state.captured = poster;
    state.recordedUrl = url;
    state.recordedBlob = blob;
    if (stageVideo) stageVideo.src = url;
    stopCamera();
    setMode('video');
    document.getElementById('stage-captured').hidden = false;
    if (thumb) thumb.querySelector('img').src = poster || thumbOriginal;
    updateModeChrome();
  };

  const runCountdown = (seconds, done) => {
    state.counting = true;
    countdown.classList.add('show');
    let n = seconds;
    const tick = () => {
      if (!state.counting) return;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = n;
      countdown.replaceChildren(num);
      void num.offsetWidth; // restart the pop animation
      if (n <= 1) {
        setTimeout(() => {
          if (state.counting) {
            state.counting = false;
            countdown.classList.remove('show');
            countdown.replaceChildren();
            done();
          }
        }, 800);
      } else {
        n -= 1;
        setTimeout(tick, 800);
      }
    };
    tick();
  };

  const shutterPress = () => {
    // A second tap during the countdown cancels it
    if (state.counting) {
      state.counting = false;
      countdown.classList.remove('show');
      countdown.replaceChildren();
      return;
    }
    // REEL tab: tap to start/stop a video recording
    if (state.type === 'videos' && state.canRecord) {
      if (state.recording) stopRecording();
      else startRecording();
      return;
    }
    // Shutter press feedback: ring squeeze + white flash
    const shutter = document.getElementById('capture-btn');
    shutter.classList.add('pressed');
    setTimeout(() => shutter.classList.remove('pressed'), 160);
    stage.classList.add('stage-flashing');
    setTimeout(() => stage.classList.remove('stage-flashing'), 180);
    if (state.timer > 0) { runCountdown(state.timer, capturePhoto); return; }
    capturePhoto();
  };
  document.getElementById('capture-btn').addEventListener('click', shutterPress);

  // Flip camera (button + double-tap on the stage)
  flipBtn?.addEventListener('click', () => {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    startCamera();
  });
  stage.addEventListener('dblclick', (event) => {
    if (state.mode !== 'camera') return;
    if (event.target !== video && event.target !== stage) return;
    flipBtn?.click();
  });

  // Bottom-left gallery thumbnail: after a capture it retakes; otherwise it opens the upload picker
  thumb?.addEventListener('click', () => {
    if (state.mode === 'photo' || state.mode === 'video') startCamera();
    else uploadInput?.click();
  });

  // Tap the captured photo (or recorded video) to retake
  photo.addEventListener('click', () => {
    if (state.mode === 'photo') startCamera();
  });
  stageVideo?.addEventListener('click', () => {
    if (state.mode === 'video') startCamera();
  });

  // Settings gear: toggles the app theme (light/dark)
  document.querySelector('.ig-top .ig-top-btn')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  });

  // Microphone preview toggle
  micBtn?.addEventListener('click', () => {
    state.mic = !state.mic;
    video.muted = !state.mic;
    updateMicButton();
  });

  // Flash: hardware torch where supported, white flash otherwise
  const updateFlashIcon = () => {
    if (!flashBtn) return;
    flashBtn.classList.toggle('on', state.torch);
    flashBtn.setAttribute('aria-label', state.torch ? 'Flash on' : 'Toggle flash');
  };
  flashBtn?.addEventListener('click', async () => {
    const track = state.stream?.getVideoTracks?.()[0];
    try {
      if (track?.applyConstraints) {
        state.torch = !state.torch;
        await track.applyConstraints({ advanced: [{ torch: state.torch }] });
      } else {
        throw new Error('no torch');
      }
    } catch (err) {
      state.torch = false;
      stage.classList.add('stage-flashing');
      setTimeout(() => stage.classList.remove('stage-flashing'), 180);
    }
    updateFlashIcon();
  });

  // Next → caption form
  const setShareRow = () => {
    if (!shareRow) return;
    shareRow.hidden = state.type !== 'stories';
  };
  const openCaptionForm = () => {
    const isVideo = state.type === 'videos' && state.recordedUrl;
    if (previewImg) previewImg.hidden = isVideo;
    if (previewVideo) {
      previewVideo.hidden = !isVideo;
      if (isVideo) {
        previewVideo.src = state.recordedUrl;
        previewVideo.poster = state.captured;
        previewVideo.play().catch(() => { /* autoplay blocked — poster still shows */ });
      } else {
        previewVideo.removeAttribute('src');
        previewVideo.load();
      }
    }
    if (previewImg) previewImg.src = state.captured || CREATE_SAMPLE_IMAGE;
    document.getElementById('create-form-head-label').textContent = state.type === 'videos' ? 'New video' : state.type === 'stories' ? 'New story' : 'New post';
    setShareRow();
    stopCamera();
    stage.hidden = true;
    tools.hidden = true;
    tabs[0].parentElement.hidden = true;
    nextBtn.hidden = true;
    form.hidden = false;
    form.querySelector('[name="title"]').focus();
  };
  nextBtn?.addEventListener('click', () => {
    if (!state.captured && !(state.type === 'videos' && state.recordedUrl)) return;
    openEditScreen();
  });

  // Back to camera
  backBtn?.addEventListener('click', () => {
    stage.hidden = false;
    tools.hidden = false;
    tabs[0].parentElement.hidden = false;
    form.hidden = true;
    if (status) status.textContent = '';
    if (state.hadCamera) startCamera();
    else setMode('camera');
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
    const location = data.get('location') || '';
    const item = { title, caption, preview, type: isVideo ? 'video' : type };
    if (location) item.location = location;
    if (isVideo && state.recordedUrl) {
      item.src = state.recordedUrl;
      item.poster = state.captured || preview;
      state.keepUrl = true;
    } else if (isVideo && preview !== CREATE_SAMPLE_VIDEO) {
      item.src = CREATE_SAMPLE_VIDEO;
    }
    userUploads[type].unshift(item);
    if (type === 'stories' && shareFeed?.checked) userUploads.feed.unshift({ ...item, type: 'feed' });
    saveUploads();
    removeDraft(state.editingDraft);
    state.editingDraft = -1;
    if (DB) {
      DB.saveMedia({ ...item, file: isVideo && state.recordedBlob ? state.recordedBlob : (file?.size ? file : null), user: window.GLITCHIT_USER?.id || '', avatar: profile.avatar }).then((res) => {
        if (!status) return;
        if (res.ok) {
          // Replace short-lived blob URLs with the durable public storage URL
          // so the local feed still works after a page refresh.
          if (res.url) {
            item.preview = isVideo ? (res.poster || item.poster || item.preview) : res.url;
            if (isVideo) item.src = res.url;
            saveUploads();
          }
          status.className = 'create-status ok'; status.textContent = `Published to ${isVideo ? 'Glitches' : type} and saved to the database.`; return;
        }
        if (res.reason === 'auth') { status.className = 'create-status'; status.textContent = `Published to ${isVideo ? 'Glitches' : type} (local only) — sign in to publish to the database.`; return; }
        if (res.reason === 'config') { status.className = 'create-status'; status.textContent = `Published to ${isVideo ? 'Glitches' : type} (local only — add Supabase keys in src/config.js).`; }
        else if (res.reason === 'table') { status.className = 'create-status'; status.textContent = `Published to ${isVideo ? 'Glitches' : type} (local only) — database needs setup: create the media & saved tables in the Supabase SQL Editor (I can re-send the script).`; }
        else { status.className = 'create-status'; status.textContent = `Published to ${isVideo ? 'Glitches' : type} (local only) — database error. Check that the tables and the glitchit-media bucket exist.`; }
      });
    } else if (status) {
      status.className = 'create-status ok';
      status.textContent = `Published to ${isVideo ? 'Glitches' : type}. View it on ${isVideo ? 'the Glitches page' : 'the Home feed'}.`;
    }
    form.reset();
    celebratePublish();
    if (status) { status.className = 'create-status ok'; status.textContent = `Published to ${isVideo ? 'Glitches' : type} ✓`; }
    clearTimeout(submitTimer);
    submitTimer = setTimeout(resetStudio, 1100);
  });

  // ---------- Polish interactions ----------

  // Grid overlay toggle (left rail)
  const gridBtn = document.getElementById('grid-btn');
  const stageGrid = document.getElementById('stage-grid');
  gridBtn?.addEventListener('click', () => {
    state.grid = !state.grid;
    gridBtn.classList.toggle('on', state.grid);
    if (stageGrid) stageGrid.classList.toggle('on', state.grid);
  });

  // Story audience selection (top-right avatars)
  const showStageToast = (msg) => {
    const toast = document.getElementById('stage-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showStageToast._t);
    showStageToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
  };
  document.querySelectorAll('.ig-profiles .profile-avatar').forEach((avatar) => {
    avatar.addEventListener('click', () => {
      document.querySelectorAll('.ig-profiles .profile-avatar').forEach((a) => a.classList.remove('active'));
      avatar.classList.add('active');
      state.audience = avatar.classList.contains('gray') ? 'close' : 'you';
      showStageToast(avatar.classList.contains('gray') ? 'Close friends only' : 'Your story');
    });
  });

  // Rail modes that aren't implemented yet give gentle feedback
  document.querySelectorAll('.ig-rail .rail-item').forEach((item) => {
    if (item.id === 'grid-btn' || item.querySelector('.rail-aa')) return;
    item.addEventListener('click', () => showStageToast(`${item.querySelector('span')?.textContent || 'Mode'} — coming soon`));
  });

  // Keyboard shortcuts: space = shutter, arrows = filters, enter = next
  window.addEventListener('keydown', (event) => {
    if (stage.hidden || !form.hidden) return;
    if (event.target.matches('input, textarea, select, button')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      document.getElementById('capture-btn')?.click();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const names = [...chips].map((c) => c.dataset.filter);
      const idx = names.indexOf(state.filter);
      const next = (idx + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
      chips[next]?.click();
    } else if (event.key === 'Enter' && (state.mode === 'photo' || state.mode === 'video')) {
      event.preventDefault();
      nextBtn?.click();
    }
  });

  // Emoji quick-row inserts into the caption at the caret
  const captionEl = form.querySelector('[name="caption"]');
  const countEl = document.getElementById('caption-count');
  const MAX_CAPTION = 2200;
  const updateCount = () => {
    if (countEl) countEl.textContent = `${captionEl?.value.length || 0}/${MAX_CAPTION}`;
  };
  captionEl?.addEventListener('input', updateCount);
  document.querySelectorAll('#caption-emojis button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!captionEl) return;
      const emoji = btn.dataset.emoji;
      const start = captionEl.selectionStart ?? captionEl.value.length;
      const end = captionEl.selectionEnd ?? start;
      captionEl.setRangeText(emoji, start, end, 'end');
      captionEl.focus();
      updateCount();
    });
  });
  updateCount();

  // ---------- Zoom (hardware where supported, CSS scale otherwise) ----------
  const ZOOM_STEPS = [1, 2, 3];
  const applyZoom = async (level) => {
    const track = state.stream?.getVideoTracks?.()[0];
    let usedHardware = false;
    if (track?.getCapabilities && track.applyConstraints) {
      const caps = track.getCapabilities();
      if (caps && caps.zoom && caps.zoom.max > 1) {
        try {
          const zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, level));
          await track.applyConstraints({ advanced: [{ zoom }] });
          video.style.transform = '';
          state.zoom = zoom > 1.1 ? Math.round(zoom) : 1;
          usedHardware = true;
        } catch (e) { /* fall through to CSS scale */ }
      }
    }
    if (!usedHardware) {
      video.style.transform = `scale(${level})`;
      state.zoom = level;
    }
    if (zoomBtn) zoomBtn.textContent = `${state.zoom}x`;
  };
  zoomBtn?.addEventListener('click', () => {
    const next = ZOOM_STEPS[(ZOOM_STEPS.indexOf(state.zoom) + 1) % ZOOM_STEPS.length];
    applyZoom(next);
  });

  // ---------- Aspect ratio (9:16 → 1:1 → 4:5 → 16:9) ----------
  const applyRatio = (ratio) => {
    state.ratio = ratio;
    stage.dataset.ratio = ratio;
    if (ratioBtn) {
      ratioBtn.textContent = ratio;
      ratioBtn.setAttribute('aria-label', `Aspect ratio ${ratio}`);
    }
  };
  ratioBtn?.addEventListener('click', () => {
    const next = RATIO_ORDER[(RATIO_ORDER.indexOf(state.ratio) + 1) % RATIO_ORDER.length];
    applyRatio(next);
    showStageToast(next === '9:16' ? 'Fullscreen' : `${next} frame`);
  });
  applyRatio(state.ratio);

  // ---------- Capture timer (off → 3s → 10s) ----------
  const TIMER_OPTIONS = [0, 3, 10];
  const updateTimerButton = () => {
    if (!timerBtn) return;
    timerBtn.classList.toggle('on', state.timer > 0);
    timerBtn.dataset.seconds = state.timer || '';
    timerBtn.setAttribute('aria-label', state.timer ? `Timer ${state.timer} seconds` : 'Timer off');
  };
  timerBtn?.addEventListener('click', () => {
    state.timer = TIMER_OPTIONS[(TIMER_OPTIONS.indexOf(state.timer) + 1) % TIMER_OPTIONS.length];
    updateTimerButton();
  });
  updateTimerButton();

  // ---------- Drafts (local storage) ----------
  const loadDrafts = () => {
    try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); } catch (e) { return []; }
  };
  const writeDrafts = (list) => {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list.slice(0, 5))); } catch (e) { /* storage unavailable */ }
  };
  const updateDraftsBadge = () => {
    const count = loadDrafts().length;
    if (draftsCount) draftsCount.textContent = count;
    if (draftsBtn) draftsBtn.hidden = state.mode !== 'camera' || count === 0;
  };
  const saveDraft = () => {
    const preview = state.captured && !state.captured.startsWith('data:') ? state.captured : '';
    const draft = {
      type: state.type,
      title: form.querySelector('[name="title"]').value,
      caption: captionEl ? captionEl.value : '',
      location: locationInput ? locationInput.value : '',
      preview,
      savedAt: Date.now(),
    };
    const drafts = loadDrafts();
    if (state.editingDraft >= 0 && drafts[state.editingDraft]) {
      drafts[state.editingDraft] = { ...drafts[state.editingDraft], ...draft };
    } else {
      drafts.unshift(draft);
      state.editingDraft = 0;
    }
    writeDrafts(drafts);
    updateDraftsBadge();
    showStageToast('Draft saved');
  };
  const restoreDraft = (index) => {
    const drafts = loadDrafts();
    const draft = drafts[index];
    if (!draft) return;
    state.editingDraft = index;
    if (draft.type && draft.type !== 'live') {
      tabs.forEach((t) => {
        const on = t.dataset.tab === draft.type;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      state.type = draft.type;
    }
    const preview = draft.preview || state.captured || '';
    if (preview) {
      state.captured = preview;
      if (previewImg) { previewImg.hidden = false; previewImg.src = preview; }
      if (previewVideo) previewVideo.hidden = true;
    }
    updateModeChrome();
    form.querySelector('[name="title"]').value = draft.title || '';
    if (captionEl) captionEl.value = draft.caption || '';
    if (locationInput) locationInput.value = draft.location || '';
    updateCount();
    document.getElementById('create-form-head-label').textContent = state.type === 'videos' ? 'New video' : state.type === 'stories' ? 'New story' : 'New post';
    setShareRow();
    stage.hidden = true;
    tools.hidden = true;
    tabs[0].parentElement.hidden = true;
    nextBtn.hidden = true;
    form.hidden = false;
    form.querySelector('[name="title"]').focus();
  };
  const removeDraft = (index) => {
    if (index < 0) return;
    const drafts = loadDrafts();
    if (drafts[index]) {
      drafts.splice(index, 1);
      writeDrafts(drafts);
    }
    updateDraftsBadge();
  };
  saveDraftBtn?.addEventListener('click', () => {
    if (!state.captured && !form.querySelector('[name="title"]').value.trim() && !captionEl.value.trim()) {
      showStageToast('Nothing to save yet');
      return;
    }
    saveDraft();
  });
  draftsBtn?.addEventListener('click', () => {
    const drafts = loadDrafts();
    if (!drafts.length) return;
    restoreDraft(state.editingDraft >= 0 && drafts[state.editingDraft] ? state.editingDraft : 0);
  });
  updateDraftsBadge();

  // ---------- Publish celebration ----------
  const celebratePublish = () => {
    const burst = document.createElement('div');
    burst.className = 'confetti-burst';
    const colors = ['#d62976', '#4f5bd5', '#ffd60a', '#30d158', '#ff9f0a', '#fff'];
    for (let i = 0; i < 16; i++) {
      const bit = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.5;
      const dist = 60 + Math.random() * 120;
      bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 60}px`);
      bit.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${Math.random() * 0.12}s`;
      burst.appendChild(bit);
    }
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 1100);
  };

  // ---------- Edit screen (adjust · filters · rotate · text · emoji · trim) ----------
  const editScreen = document.getElementById('edit-screen');
  const editPhotoEl = document.getElementById('edit-photo');
  const editVideoEl = document.getElementById('edit-video');
  const editMedia = document.getElementById('edit-media');
  const editOverlay = document.getElementById('edit-overlay');
  const editPanel = document.getElementById('edit-panel');
  const editNextBtn = document.getElementById('edit-next');
  const editBackBtn = document.getElementById('edit-back');
  const editTools = [...document.querySelectorAll('.edit-tool')];
  let editorKind = 'photo';
  const DEFAULT_EDIT = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, rotate: 0, flipH: false, flipV: false, texts: [], emojis: [], trimStart: 0, trimEnd: Infinity, trimSet: false };
  state.edit = { ...DEFAULT_EDIT };

  const editFilterString = () => {
    const base = (CREATE_FILTERS[state.filter] || CREATE_FILTERS.none).filter;
    const e = state.edit;
    const parts = [`brightness(${e.brightness / 100})`, `contrast(${e.contrast / 100})`, `saturate(${e.saturation / 100})`];
    if (e.warmth > 0) parts.push(`sepia(${e.warmth / 200})`);
    else if (e.warmth < 0) parts.push(`hue-rotate(${Math.round(e.warmth * 0.9)}deg)`);
    return [base, parts.join(' ')].filter(Boolean).join(' ');
  };

  const editHasChanges = () => {
    const e = state.edit;
    return state.filter !== 'none' || e.brightness !== 100 || e.contrast !== 100 || e.saturation !== 100 || e.warmth !== 0 ||
      e.rotate !== 0 || e.flipH || e.flipV || e.texts.length > 0 || e.emojis.length > 0 || e.trimSet;
  };

  const resetEdit = () => {
    state.edit = { ...DEFAULT_EDIT, texts: [], emojis: [] };
  };

  const showEditToast = (msg) => {
    const toast = document.getElementById('edit-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showEditToast._t);
    showEditToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
  };

  // The preview box keeps the media's (post-rotation) aspect, so overlay
  // percentages map 1:1 onto the baked canvas coordinates.
  const sizeEditMedia = () => {
    const e = state.edit;
    const swap = e.rotate % 180 !== 0;
    const natW = editorKind === 'video' ? (editVideoEl.videoWidth || 9) : (editPhotoEl.naturalWidth || 9);
    const natH = editorKind === 'video' ? (editVideoEl.videoHeight || 16) : (editPhotoEl.naturalHeight || 16);
    const stageRect = editScreen.getBoundingClientRect();
    const w = swap ? natH : natW;
    const h = swap ? natW : natH;
    const scale = Math.min((stageRect.width - 12) / w, (stageRect.height - 150) / h, 1.5);
    editMedia.style.width = `${Math.max(40, Math.round(w * scale))}px`;
    editMedia.style.height = `${Math.max(40, Math.round(h * scale))}px`;
  };

  const renderEditOverlay = () => {
    const k = (editMedia.getBoundingClientRect().width || 1080) / 1080;
    const items = [
      ...state.edit.texts.map((t) => `<span class="edit-item edit-item-text" data-kind="text" data-id="${t.id}" style="left:${t.x}%;top:${t.y}%;color:${t.color};font-size:${Math.max(12, Math.round(t.size * k))}px">${escapeHtml(t.text)}</span>`),
      ...state.edit.emojis.map((m) => `<span class="edit-item edit-item-emoji" data-kind="emoji" data-id="${m.id}" style="left:${m.x}%;top:${m.y}%;font-size:${Math.max(16, Math.round(m.size * k))}px">${m.emoji}</span>`),
    ].join('');
    editOverlay.innerHTML = items;
  };

  const applyEditPreview = () => {
    const el = editorKind === 'video' ? editVideoEl : editPhotoEl;
    if (!el) return;
    el.style.filter = editFilterString();
    const e = state.edit;
    el.style.transform = `rotate(${e.rotate}deg) scale(${e.flipH ? -1 : 1}, ${e.flipV ? -1 : 1})`;
    sizeEditMedia();
    renderEditOverlay();
  };

  // Drag text/stickers on the preview (pointer events cover mouse + touch).
  editOverlay.addEventListener('pointerdown', (event) => {
    const item = event.target.closest('.edit-item');
    if (!item) return;
    event.preventDefault();
    const kind = item.dataset.kind;
    const id = item.dataset.id;
    const rect = editMedia.getBoundingClientRect();
    const moveAt = (clientX, clientY) => {
      const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
      item.style.left = `${x}%`;
      item.style.top = `${y}%`;
      item.dataset.x = x;
      item.dataset.y = y;
    };
    moveAt(event.clientX, event.clientY);
    const onMove = (ev) => moveAt(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const list = kind === 'text' ? state.edit.texts : state.edit.emojis;
      const entry = list.find((i) => i.id === id);
      if (entry) { entry.x = parseFloat(item.dataset.x); entry.y = parseFloat(item.dataset.y); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  editOverlay.addEventListener('dblclick', (event) => {
    const item = event.target.closest('.edit-item');
    if (!item) return;
    const kind = item.dataset.kind;
    state.edit[kind === 'text' ? 'texts' : 'emojis'] = (kind === 'text' ? state.edit.texts : state.edit.emojis).filter((i) => i.id !== item.dataset.id);
    renderEditOverlay();
    showEditToast('Removed');
  });

  // ----- Tool panels -----
  const buildAdjustPanel = () => {
    const e = state.edit;
    editPanel.innerHTML = `<div class="edit-sliders">
      ${ADJUST_KEYS.map((k) => `<label class="edit-slider"><span>${ADJUST_LABELS[k]}</span><input type="range" data-adjust="${k}" min="${k === 'warmth' ? -50 : 50}" max="${k === 'warmth' ? 50 : 150}" value="${e[k]}"><b>${e[k]}</b></label>`).join('')}
      <button type="button" class="edit-reset" data-reset="adjust">Reset</button>
    </div>`;
    editPanel.querySelectorAll('input[data-adjust]').forEach((input) => {
      input.addEventListener('input', () => {
        state.edit[input.dataset.adjust] = parseFloat(input.value);
        input.nextElementSibling.textContent = input.value;
        applyEditPreview();
      });
    });
    editPanel.querySelector('[data-reset="adjust"]').addEventListener('click', () => {
      ADJUST_KEYS.forEach((k) => { state.edit[k] = DEFAULT_EDIT[k]; });
      applyEditPreview();
      openEditTool('adjust');
    });
  };

  const buildFiltersPanel = () => {
    const thumb = state.captured || CREATE_SAMPLE_IMAGE;
    const chips = Object.keys(CREATE_FILTERS).map((name) => {
      const active = state.filter === name ? ' active' : '';
      return `<button type="button" class="filter-chip edit-filter-chip${active}" data-filter="${name}" aria-label="${name}"><img class="chip-thumb" src="${thumb}" alt="" loading="lazy"></button>`;
    }).join('');
    editPanel.innerHTML = `<div class="edit-filter-strip" id="edit-filter-strip">${chips}</div>`;
    editPanel.querySelectorAll('.edit-filter-chip').forEach((chip) => {
      chip.querySelector('.chip-thumb').style.filter = (CREATE_FILTERS[chip.dataset.filter] || CREATE_FILTERS.none).filter;
      chip.addEventListener('click', () => {
        editPanel.querySelectorAll('.edit-filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
        state.filter = chip.dataset.filter;
        applyFilter();
        applyEditPreview();
      });
    });
  };

  const buildRotatePanel = () => {
    const e = state.edit;
    editPanel.innerHTML = `<div class="edit-rotate-row">
      <button type="button" class="edit-rotate-btn" data-rot="-90" aria-label="Rotate left">↺</button>
      <button type="button" class="edit-rotate-btn" data-rot="90" aria-label="Rotate right">↻</button>
      <button type="button" class="edit-rotate-btn${e.flipH ? ' on' : ''}" data-flip="h" aria-label="Flip horizontally">⇋</button>
      <button type="button" class="edit-rotate-btn${e.flipV ? ' on' : ''}" data-flip="v" aria-label="Flip vertically">⇅</button>
      <button type="button" class="edit-reset" data-reset="rotate">Reset</button>
    </div>`;
    editPanel.querySelectorAll('[data-rot]').forEach((btn) => btn.addEventListener('click', () => {
      state.edit.rotate = (state.edit.rotate + parseInt(btn.dataset.rot, 10) + 360) % 360;
      applyEditPreview();
    }));
    editPanel.querySelectorAll('[data-flip]').forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.dataset.flip === 'h' ? 'flipH' : 'flipV';
      state.edit[key] = !state.edit[key];
      applyEditPreview();
      btn.classList.toggle('on', state.edit[key]);
    }));
    editPanel.querySelector('[data-reset="rotate"]').addEventListener('click', () => {
      state.edit.rotate = 0; state.edit.flipH = false; state.edit.flipV = false;
      applyEditPreview();
      openEditTool('rotate');
    });
  };

  const buildTextPanel = () => {
    editPanel.innerHTML = `<div class="edit-text-tools">
      <div class="edit-text-input-row">
        <input type="text" id="edit-text-input" placeholder="Type something…" maxlength="80" aria-label="Text to add">
        <button type="button" class="edit-add-btn" id="edit-add-text">Add</button>
      </div>
      <div class="edit-swatch-row" role="group" aria-label="Text color">
        ${TEXT_COLORS.map((c) => `<button type="button" class="edit-swatch" data-color="${c}" style="--swatch:${c}" aria-label="Color ${c}"></button>`).join('')}
      </div>
      <label class="edit-slider"><span>Size</span><input type="range" id="edit-text-size" min="18" max="96" value="46"><b>46</b></label>
      <p class="edit-tip">Drag text on the preview to move it · double-tap to delete</p>
    </div>`;
    let color = '#ffffff';
    editPanel.querySelectorAll('.edit-swatch').forEach((sw) => sw.addEventListener('click', () => {
      editPanel.querySelectorAll('.edit-swatch').forEach((s) => s.classList.toggle('active', s === sw));
      color = sw.dataset.color;
    }));
    const sizeInput = editPanel.querySelector('#edit-text-size');
    sizeInput.addEventListener('input', () => { sizeInput.nextElementSibling.textContent = sizeInput.value; });
    const addText = () => {
      const input = editPanel.querySelector('#edit-text-input');
      const text = (input.value || '').trim();
      if (!text) { showEditToast('Type some text first'); return; }
      state.edit.texts.push({ id: `t${Date.now()}`, text, color, size: parseFloat(sizeInput.value), x: 50, y: 26 });
      renderEditOverlay();
      input.value = '';
      showEditToast('Text added — drag to place it');
    };
    editPanel.querySelector('#edit-add-text').addEventListener('click', addText);
    editPanel.querySelector('#edit-text-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addText(); });
  };

  const buildEmojiPanel = () => {
    editPanel.innerHTML = `<div class="edit-emoji-grid" aria-label="Stickers">${EMOJI_CHOICES.map((m) => `<button type="button" class="edit-emoji-btn" data-emoji="${m}" aria-label="Add ${m}">${m}</button>`).join('')}</div>
    <p class="edit-tip">Tap a sticker to add it · drag to move · double-tap to delete</p>`;
    editPanel.querySelectorAll('.edit-emoji-btn').forEach((btn) => btn.addEventListener('click', () => {
      state.edit.emojis.push({ id: `e${Date.now()}`, emoji: btn.dataset.emoji, size: 58, x: 50, y: 62 });
      renderEditOverlay();
      showEditToast('Sticker added');
    }));
  };

  const buildTrimPanel = () => {
    const dur = editVideoEl.duration || 0;
    if (!dur) { editPanel.innerHTML = '<p class="edit-tip">Loading clip…</p>'; return; }
    const e = state.edit;
    const start = e.trimSet ? e.trimStart : 0;
    const end = e.trimSet ? Math.min(e.trimEnd, dur) : dur;
    editPanel.innerHTML = `<div class="edit-trim">
      <div class="edit-trim-labels"><span>Start <b id="trim-start-label">${start.toFixed(1)}s</b></span><span>End <b id="trim-end-label">${end.toFixed(1)}s</b></span></div>
      <label class="edit-slider"><span>Start</span><input type="range" id="trim-start" min="0" max="${Math.max(0.1, dur - 0.05).toFixed(2)}" step="0.05" value="${start.toFixed(2)}"><b></b></label>
      <label class="edit-slider"><span>End</span><input type="range" id="trim-end" min="0.05" max="${dur.toFixed(2)}" step="0.05" value="${Math.max(0.05, end).toFixed(2)}"><b></b></label>
      <div class="edit-trim-actions"><button type="button" class="edit-reset" data-reset="trim">Reset to full clip</button></div>
    </div>`;
    const startInput = editPanel.querySelector('#trim-start');
    const endInput = editPanel.querySelector('#trim-end');
    const sync = () => {
      let s = parseFloat(startInput.value);
      let en = parseFloat(endInput.value);
      if (s >= en) {
        if (document.activeElement === startInput) s = Math.max(0, en - 0.05);
        else en = s + 0.05;
        startInput.value = s.toFixed(2);
        endInput.value = en.toFixed(2);
      }
      state.edit.trimStart = s;
      state.edit.trimEnd = en;
      state.edit.trimSet = true;
      editPanel.querySelector('#trim-start-label').textContent = `${s.toFixed(1)}s`;
      editPanel.querySelector('#trim-end-label').textContent = `${en.toFixed(1)}s`;
      if (editVideoEl.currentTime < s || editVideoEl.currentTime > en) editVideoEl.currentTime = s;
    };
    startInput.addEventListener('input', () => { endInput.min = (parseFloat(startInput.value) + 0.05).toFixed(2); sync(); });
    endInput.addEventListener('input', () => { startInput.max = (parseFloat(endInput.value) - 0.05).toFixed(2); sync(); });
    editPanel.querySelector('[data-reset="trim"]').addEventListener('click', () => {
      state.edit.trimSet = false;
      state.edit.trimStart = 0;
      state.edit.trimEnd = dur;
      openEditTool('trim');
    });
  };

  const openEditTool = (name) => {
    editTools.forEach((t) => t.classList.toggle('active', t.dataset.editTool === name));
    editPanel.hidden = false;
    ({ adjust: buildAdjustPanel, filters: buildFiltersPanel, rotate: buildRotatePanel, text: buildTextPanel, emoji: buildEmojiPanel, trim: buildTrimPanel })[name]?.();
  };
  editTools.forEach((t) => t.addEventListener('click', () => openEditTool(t.dataset.editTool)));

  // Keep video preview playback inside the trimmed window.
  editVideoEl?.addEventListener('timeupdate', () => {
    const e = state.edit;
    if (!e.trimSet) return;
    if (editVideoEl.currentTime >= e.trimEnd - 0.03 || editVideoEl.currentTime < e.trimStart) {
      editVideoEl.currentTime = e.trimStart;
    }
  });

  const openEditScreen = () => {
    const isVideo = state.type === 'videos' && state.recordedUrl;
    editorKind = isVideo ? 'video' : 'photo';
    resetEdit();
    form.hidden = true;
    stage.hidden = true;
    tools.hidden = true;
    tabs[0].parentElement.hidden = true;
    nextBtn.hidden = true;
    editScreen.hidden = false;
    editTools.forEach((t) => { t.hidden = t.dataset.editTool === 'trim' && editorKind !== 'video'; });
    if (editorKind === 'video') {
      editPhotoEl.hidden = true;
      editVideoEl.hidden = false;
      editVideoEl.src = state.recordedUrl;
      editVideoEl.poster = state.captured || '';
      const onMeta = () => {
        if (!state.edit.trimSet) state.edit.trimEnd = editVideoEl.duration || Infinity;
        applyEditPreview();
        editVideoEl.play().catch(() => { /* preview paused until user interacts */ });
      };
      if (editVideoEl.readyState >= 1) onMeta();
      else editVideoEl.onloadedmetadata = onMeta;
    } else {
      editVideoEl.hidden = true;
      editVideoEl.pause();
      editPhotoEl.hidden = false;
      editPhotoEl.src = state.captured || CREATE_SAMPLE_IMAGE;
      applyEditPreview();
    }
    openEditTool('adjust');
  };

  editBackBtn?.addEventListener('click', () => {
    editScreen.hidden = true;
    editPanel.hidden = true;
    editVideoEl.pause();
    editVideoEl.removeAttribute('src');
    editVideoEl.load();
    editOverlay.innerHTML = '';
    stage.hidden = false;
    tools.hidden = false;
    tabs[0].parentElement.hidden = false;
    if (state.hadCamera) startCamera();
    else setMode('camera');
  });

  // ----- Bake edits into the posted media -----
  const loadEditImage = (src) => new Promise((resolve) => {
    if (src.startsWith('data:')) {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
      return;
    }
    fetch(src)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('fetch failed'))))
      .then((blob) => new Promise((resolveBlob) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolveBlob(img); };
        img.onerror = () => { URL.revokeObjectURL(url); resolveBlob(null); };
        img.src = url;
      }))
      .catch(() => resolve(null));
  });

  const drawOverlays = (ctx, W, H) => {
    const k = W / 1080;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    state.edit.texts.forEach((t) => {
      const size = Math.max(12, Math.round(t.size * k));
      ctx.font = `900 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = Math.max(3, size / 7);
      const x = (t.x / 100) * W;
      const y = (t.y / 100) * H;
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    });
    state.edit.emojis.forEach((m) => {
      const size = Math.max(16, Math.round(m.size * k));
      ctx.font = `${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.fillText(m.emoji, (m.x / 100) * W, (m.y / 100) * H);
    });
  };

  const bakeEditedImage = async (src) => {
    const img = await loadEditImage(src);
    if (!img) return src;
    const e = state.edit;
    try {
      const swap = e.rotate % 180 !== 0;
      let W = swap ? img.naturalHeight : img.naturalWidth;
      let H = swap ? img.naturalWidth : img.naturalHeight;
      const cap = Math.min(1, 2160 / Math.max(W, H));
      W = Math.round(W * cap);
      H = Math.round(H * cap);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      ctx.filter = editFilterString() || 'none';
      ctx.translate(W / 2, H / 2);
      ctx.scale(cap, cap);
      ctx.rotate((e.rotate * Math.PI) / 180);
      ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawOverlays(ctx, W, H);
      return c.toDataURL('image/jpeg', 0.92);
    } catch (err) {
      console.warn('GlitchIt: image bake failed', err);
      return src;
    }
  };

  // Re-encode an edited clip through a canvas: filters/adjustments/rotate/
  // text/stickers are drawn per frame; audio is preserved via Web Audio.
  const bakeEditedVideo = async () => {
    const srcV = document.createElement('video');
    srcV.src = state.recordedUrl;
    srcV.preload = 'auto';
    srcV.playsInline = true;
    await new Promise((resolve) => {
      if (srcV.readyState >= 1) { resolve(); return; }
      srcV.onloadedmetadata = () => resolve();
      srcV.onerror = () => resolve();
      srcV.load();
    });
    const dur = srcV.duration || 0;
    if (!dur || !srcV.videoWidth) return { blob: null };
    const e = state.edit;
    const start = e.trimSet ? Math.max(0, Math.min(e.trimStart, dur - 0.1)) : 0;
    const end = e.trimSet ? Math.min(e.trimEnd, dur) : dur;
    const clipDur = Math.max(0.15, end - start);
    const swap = e.rotate % 180 !== 0;
    let W = swap ? srcV.videoHeight : srcV.videoWidth;
    let H = swap ? srcV.videoWidth : srcV.videoHeight;
    const cap = Math.min(1, 1920 / Math.max(W, H));
    W = Math.round(W * cap);
    H = Math.round(H * cap);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const captureStream = canvas.captureStream || canvas.mozCaptureStream || canvas.webkitCaptureStream;
    if (typeof captureStream !== 'function') return { blob: null, unsupported: true };
    let audioTracks = [];
    let ac = null;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      await ac.resume();
      const srcNode = ac.createMediaElementSource(srcV);
      const dest = ac.createMediaStreamDestination();
      srcNode.connect(dest);
      audioTracks = dest.stream.getAudioTracks();
    } catch (err) { ac = null; audioTracks = []; }
    const stream = captureStream.call(canvas, 30);
    const mixed = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
    const mimeType = pickRecorderMime();
    let recorder;
    try {
      recorder = new MediaRecorder(mixed, { mimeType: mimeType || undefined, videoBitsPerSecond: 6e6 });
    } catch (err) {
      if (ac) { try { ac.close(); } catch (e) { /* ignore */ } }
      return { blob: null, unsupported: true };
    }
    const chunks = [];
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: chunks[0]?.type || 'video/webm' }));
    });
    const drawFrame = () => {
      ctx.filter = editFilterString() || 'none';
      ctx.translate(W / 2, H / 2);
      ctx.scale(cap, cap);
      ctx.rotate((e.rotate * Math.PI) / 180);
      ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
      ctx.drawImage(srcV, -srcV.videoWidth / 2, -srcV.videoHeight / 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawOverlays(ctx, W, H);
    };
    await new Promise((resolve) => {
      const onSeeked = () => { srcV.removeEventListener('seeked', onSeeked); resolve(); };
      srcV.addEventListener('seeked', onSeeked);
      srcV.currentTime = start;
    });
    drawFrame();
    let poster = '';
    try { poster = canvas.toDataURL('image/jpeg', 0.85); } catch (err) { poster = ''; }
    try { recorder.start(200); } catch (err) {
      if (ac) { try { ac.close(); } catch (e) { /* ignore */ } }
      return { blob: null, unsupported: true };
    }
    const t0 = performance.now();
    let playing = false;
    try { await srcV.play(); playing = true; } catch (err) {
      try { srcV.muted = true; await srcV.play(); playing = true; } catch (err2) { playing = false; }
    }
    await new Promise((resolve) => {
      const stopAll = () => {
        clearTimeout(timer);
        try { srcV.pause(); } catch (err) { /* ignore */ }
        try { recorder.stop(); } catch (err) { /* ignore */ }
        resolve();
      };
      const timer = setTimeout(() => stopAll(), clipDur * 1000 + 4000);
      const loop = () => {
        const elapsed = (performance.now() - t0) / 1000;
        if (recorder.state !== 'recording' || elapsed >= clipDur || srcV.currentTime >= end - 0.04 || srcV.ended) { stopAll(); return; }
        if (!playing) srcV.currentTime = Math.min(end, start + elapsed);
        drawFrame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const blob = await stopped;
    if (ac) { try { ac.close(); } catch (err) { /* ignore */ } }
    return { blob, poster };
  };

  editNextBtn?.addEventListener('click', async () => {
    const processing = document.getElementById('edit-processing');
    if (processing) processing.hidden = false;
    try {
      if (editorKind === 'video') {
        editVideoEl.pause();
        if (editHasChanges()) {
          const res = await bakeEditedVideo();
          if (res.blob) {
            const editedUrl = URL.createObjectURL(res.blob);
            const oldUrl = state.recordedUrl;
            state.recordedUrl = editedUrl;
            state.recordedBlob = res.blob;
            state.keepUrl = false;
            if (oldUrl && oldUrl !== editedUrl) URL.revokeObjectURL(oldUrl);
            if (res.poster) state.captured = res.poster;
          } else if (res.unsupported) {
            showEditToast('This browser can\u2019t re-encode — posting the original clip with the edited cover');
          }
        }
      } else if (editHasChanges()) {
        const src = state.captured || CREATE_SAMPLE_IMAGE;
        const baked = await bakeEditedImage(src);
        if (baked && baked !== src) state.captured = baked;
      }
    } catch (err) {
      console.warn('GlitchIt: edit bake failed', err);
      showEditToast('Couldn\u2019t apply edits — posting the original');
    }
    if (processing) processing.hidden = true;
    editScreen.hidden = true;
    editOverlay.innerHTML = '';
    openCaptionForm();
  });

  // Enter on the edit screen advances; Escape goes back to the camera.
  window.addEventListener('keydown', (event) => {
    if (editScreen.hidden) return;
    if (event.key === 'Enter' && !event.target.matches('input, textarea, select, button')) {
      event.preventDefault();
      editNextBtn?.click();
    } else if (event.key === 'Escape') {
      editBackBtn?.click();
    }
  });

  window.addEventListener('pagehide', () => {
    clearRecordingState();
    stopCamera();
  });
  startCamera();

  // Live database setup status so failures are self-explanatory.
  if (DB) {
    DB.checkSetup().then((s) => {
      const el = document.getElementById('create-status');
      if (!el) return;
      if (!s.configured) el.textContent = 'Database: keys not set (src/config.js)';
      else if (!s.mediaTable || !s.savedTable || !s.bucket) {
        const missing = [!s.mediaTable && 'media table', !s.savedTable && 'saved table', !s.bucket && 'glitchit-media bucket'].filter(Boolean).join(', ');
        el.textContent = `Database: almost ready — create the ${missing} in Supabase (SQL Editor + Storage), then refresh.`;
      } else el.textContent = 'Database: connected ✓';
    });
  }
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

// Apply the saved theme on every page, not just the one holding the toggle.
function applySavedTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.dataset.theme = saved;
}

function attachThemeToggle() {
  applySavedTheme();
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  toggle.checked = localStorage.getItem(THEME_KEY) === 'dark';
  toggle.addEventListener('change', () => {
    const theme = toggle.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  });
}

// ---------- Shop page ----------
function attachShopTabs() {
  const tabs = [...document.querySelectorAll('.shop-tab')];
  if (!tabs.length) return;
  const panels = [...document.querySelectorAll('[data-shop-panel]')];
  const show = (name) => {
    tabs.forEach((t) => {
      const on = t.dataset.shopTab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach((p) => { p.hidden = p.dataset.shopPanel !== name; });
    try { sessionStorage.setItem('glitchit.shopTab', name); } catch (e) { /* ignore */ }
  };
  let saved = null;
  try { saved = sessionStorage.getItem('glitchit.shopTab'); } catch (e) { /* ignore */ }
  show(tabs.some((t) => t.dataset.shopTab === saved) ? saved : 'feed');
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.shopTab)));
}

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

// ---------- Reels interactions (like + follow toggles) ----------
function attachReelsActions() {
  document.querySelectorAll('.reel-like').forEach((btn) => {
    if (btn.dataset.reelReady) return;
    btn.dataset.reelReady = 'true';
    btn.addEventListener('click', () => {
      const on = btn.classList.toggle('liked');
      const count = btn.querySelector('b');
      if (!count) return;
      const value = parseFloat(count.textContent) || 0;
      const suffix = count.textContent.includes('K') ? 'K' : '';
      count.textContent = Math.max(0, value + (on ? 1 : -1)) + suffix;
    });
  });
  document.querySelectorAll('.reel-follow').forEach((btn) => {
    if (btn.dataset.followReady) return;
    btn.dataset.followReady = 'true';
    btn.addEventListener('click', () => {
      const on = btn.classList.toggle('following');
      btn.textContent = on ? 'Following' : 'Follow';
    });
  });
  document.querySelectorAll('.reel-save').forEach((btn) => {
    if (btn.dataset.saveReady) return;
    btn.dataset.saveReady = 'true';
    btn.addEventListener('click', async () => {
      const card = btn.closest('.video-card');
      const video = {
        id: btn.dataset.videoId || '',
        src: card?.querySelector('video')?.getAttribute('src') || '',
        poster: card?.querySelector('video')?.getAttribute('poster') || '',
        title: card?.querySelector('video')?.getAttribute('aria-label') || '',
        caption: card?.querySelector('.reel-meta p')?.textContent || '',
        user: card?.querySelector('.reel-meta strong')?.textContent || 'b3ice_drage',
        avatar: card?.querySelector('.reel-creator img')?.getAttribute('src') || '',
      };
      const saving = btn.classList.toggle('saved');
      btn.setAttribute('aria-label', `${saving ? 'Unsave' : 'Save'} ${video.title}`);
      if (saving) await DB?.saveVideo(video);
      else await DB?.unsaveVideo(video);
    });
  });
}

// Mark reel cards that are already saved (bookmark filled) once saved list loads.
function markSavedReels() {
  if (!DB) return;
  DB.loadSaved().then((saved) => {
    if (!saved.length) return;
    document.querySelectorAll('.reel-save').forEach((btn) => {
      const src = btn.closest('.video-card')?.querySelector('video')?.getAttribute('src');
      if (src && saved.some((s) => s.url === src)) {
        btn.classList.add('saved');
        btn.setAttribute('aria-label', `Unsave ${btn.closest('.video-card')?.querySelector('video')?.getAttribute('aria-label') || 'video'}`);
      }
    });
  });
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
  if (page !== 'auth' && !sessionStorage.getItem(SPLASH_KEY)) {
    sessionStorage.setItem(SPLASH_KEY, '1');
    showSplashScreen();
  }
} catch (e) { /* sessionStorage unavailable — skip splash */ }

// ---------- Notes (Messages + home instants) with music ----------
const NOTES_KEY = 'glitchit.notes.v1';
let userNotes = [];
try {
  const savedNotes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
  if (Array.isArray(savedNotes)) userNotes = savedNotes;
} catch (e) { /* corrupted storage */ }
function saveNotes() {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(userNotes)); } catch (e) { /* storage unavailable */ }
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const noteState = { audio: null, uiReady: false, currentUrl: null, composerMusic: null, viewerIndex: -1, containers: new Set(), trackCache: {}, trimTimer: null, trimStart: 0, trimEnd: Infinity };

function thumbFor(track) {
  return track.art || '';
}
function clearTrimTimer() {
  if (noteState.trimTimer) { clearInterval(noteState.trimTimer); noteState.trimTimer = null; }
}
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function findTrack(id) {
  return noteState.trackCache[id] || null;
}

function notePlay(track, button) {
  if (!track?.url) return;
  const url = track.url;
  const trim = typeof track.start === 'number' && typeof track.duration === 'number' && track.duration > 0;
  noteState.trimStart = trim ? Math.max(0, track.start) : 0;
  noteState.trimEnd = trim ? noteState.trimStart + track.duration : Infinity;
  if (noteState.currentUrl === url) {
    if (noteState.audio.paused) {
      if (trim && noteState.audio.currentTime < noteState.trimStart) noteState.audio.currentTime = noteState.trimStart;
      noteState.audio.play().catch(() => {});
      if (button) button.textContent = '❚❚';
    } else {
      noteState.audio.pause();
      if (button) button.textContent = '▶';
    }
    return;
  }
  noteState.audio.pause();
  clearTrimTimer();
  noteState.currentUrl = url;
  document.querySelectorAll('[data-note-play]').forEach((b) => { b.textContent = '▶'; });
  if (button) button.textContent = '❚❚';
  noteState.trackCache[url] = track;
  noteState.audio.src = url;
  const startPlay = () => {
    if (trim && noteState.audio.currentTime < noteState.trimStart) noteState.audio.currentTime = noteState.trimStart;
    noteState.audio.play().catch(() => {});
  };
  if (noteState.audio.readyState >= 1) startPlay();
  else noteState.audio.addEventListener('loadedmetadata', startPlay, { once: true });
}

function noteStop() {
  if (noteState.audio) noteState.audio.pause();
  clearTrimTimer();
  noteState.currentUrl = null;
  document.querySelectorAll('[data-note-play]').forEach((b) => { b.textContent = '▶'; });
}

function buildNotesUi() {
  if (noteState.uiReady) return;
  noteState.uiReady = true;
  noteState.audio = new Audio();
  noteState.audio.preload = 'none';
  noteState.audio.addEventListener('ended', () => { noteState.currentUrl = null; document.querySelectorAll('[data-note-play]').forEach((b) => { b.textContent = '▶'; }); });
  noteState.audio.addEventListener('timeupdate', () => {
    if (noteState.trimEnd !== Infinity && noteState.audio.currentTime >= noteState.trimEnd) {
      noteState.audio.pause();
      noteState.currentUrl = null;
      document.querySelectorAll('[data-note-play]').forEach((b) => { b.textContent = '▶'; });
    }
  });
  document.body.appendChild(noteState.audio);

  const composer = document.createElement('div');
  composer.className = 'note-modal';
  composer.id = 'note-composer';
  composer.hidden = true;
  composer.innerHTML = `<div class="note-modal-card"><button type="button" class="note-modal-close" data-close aria-label="Close">×</button><div class="note-composer-head"><img class="note-avatar" src="${profile.avatar}" alt=""><strong>${escapeHtml(profile.username)}</strong></div><textarea class="note-text" placeholder="Share a note with the people you know..."></textarea><div class="note-music-row" id="note-music-row" hidden><span class="note-music-chip"><span class="note-music-note">♪</span><span><b id="note-music-title"></b><em id="note-music-artist"></em></span><button type="button" class="note-chip-btn" id="note-music-play" data-note-play aria-label="Play preview">▶</button><button type="button" class="note-chip-btn" id="note-music-clear" aria-label="Remove music">×</button></span></div><div class="note-trim-row" id="note-trim-row" hidden><span class="note-trim-label">✂ Clip</span><label>Start (s)<input id="note-trim-start" type="number" min="0" step="1" value="0"></label><label>Length (s)<input id="note-trim-len" type="number" min="1" step="1" value="30"></label><em id="note-trim-hint">Plays the full track</em></div><div class="note-composer-actions"><button type="button" class="note-add-music" id="note-add-music">♪ Add music</button><button type="button" class="primary-action" id="note-post">Share</button></div></div>`;
  document.body.appendChild(composer);

  const library = document.createElement('div');
  library.className = 'note-modal';
  library.id = 'music-library';
  library.hidden = true;
  library.innerHTML = `<div class="note-modal-card"><button type="button" class="note-modal-close" data-close aria-label="Close">×</button><h3 class="music-title">Music library</h3><p class="music-hint">Type any song, artist, or genre — GlitchIt searches the web (Apple Music + Deezer) in the background and plays it right here.</p><input class="music-search" id="music-search" placeholder="Search songs, artists, or genres..."><div class="music-list" id="music-list"></div></div>`;
  document.body.appendChild(library);

  const viewer = document.createElement('div');
  viewer.className = 'note-modal';
  viewer.id = 'note-viewer';
  viewer.hidden = true;
  viewer.innerHTML = `<div class="note-modal-card note-viewer-card"><button type="button" class="note-modal-close" data-close aria-label="Close">×</button><img class="note-avatar note-viewer-avatar" id="viewer-avatar" alt=""><h3 id="viewer-author"></h3><p id="viewer-text"></p><div class="note-music-row" id="viewer-music" hidden><span class="note-music-chip"><span class="note-music-note">♪</span><span><b id="viewer-music-title"></b><em id="viewer-music-artist"></em></span><button type="button" class="note-chip-btn" id="viewer-play" data-note-play aria-label="Play">▶</button></span></div><button type="button" class="note-delete" id="note-delete" hidden>🗑 Delete note</button></div>`;
  document.body.appendChild(viewer);

  document.querySelectorAll('.note-modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) {
        modal.hidden = true;
        noteStop();
      }
    });
  });

  document.getElementById('note-add-music').addEventListener('click', () => { renderMusicLibrary(); document.getElementById('music-library').hidden = false; });
  document.getElementById('note-music-play').addEventListener('click', (e) => { e.stopPropagation(); if (noteState.composerMusic) notePlay(noteState.composerMusic, e.currentTarget); });
  document.getElementById('note-music-clear').addEventListener('click', () => { noteState.composerMusic = null; document.getElementById('note-music-row').hidden = true; document.getElementById('note-trim-row').hidden = true; noteStop(); });
  document.getElementById('note-trim-start').addEventListener('input', applyTrim);
  document.getElementById('note-trim-len').addEventListener('input', applyTrim);
  document.getElementById('note-post').addEventListener('click', () => {
    const textInput = composer.querySelector('.note-text');
    const text = textInput.value.trim();
    if (!text) { textInput.focus(); return; }
    const m = noteState.composerMusic;
    userNotes.unshift({ id: Date.now(), author: profile.username, avatar: profile.avatar, text, music: m ? { title: m.title, artist: m.artist, genre: m.genre, videoId: m.videoId || null, url: m.url || null, art: m.art || null, source: m.source || null, start: m.start, duration: m.duration } : null, createdAt: Date.now() });
    saveNotes();
    noteState.composerMusic = null;
    textInput.value = '';
    document.getElementById('note-music-row').hidden = true;
    document.getElementById('note-trim-row').hidden = true;
    composer.hidden = true;
    noteStop();
    renderNoteShelves();
  });
  document.getElementById('music-search').addEventListener('input', renderMusicLibrary);
  document.getElementById('viewer-play').addEventListener('click', (e) => {
    e.stopPropagation();
    const note = userNotes[noteState.viewerIndex];
    if (note?.music) notePlay(note.music, e.currentTarget);
  });
  document.getElementById('note-delete').addEventListener('click', () => {
    const note = userNotes[noteState.viewerIndex];
    if (!note) return;
    if (!confirm(`Delete ${note.author}'s note?`)) return;
    userNotes.splice(noteState.viewerIndex, 1);
    saveNotes();
    noteStop();
    document.getElementById('note-viewer').hidden = true;
    renderNoteShelves();
  });
}

function applyTrim() {
  const m = noteState.composerMusic;
  if (!m) return;
  const start = Math.max(0, Number(document.getElementById('note-trim-start').value) || 0);
  const len = Math.max(1, Number(document.getElementById('note-trim-len').value) || 30);
  m.start = start;
  m.duration = len;
  document.getElementById('note-trim-hint').textContent = `Plays ${fmtTime(start)}–${fmtTime(start + len)}`;
}

let ytSearchTimer = null;

function renderTrackRows(tracks, list, emptyMsg) {
  list.innerHTML = tracks.length
    ? tracks.map((t) => {
        const id = t.url;
        const thumb = thumbFor(t);
        return `<button type="button" class="music-row" data-id="${escapeHtml(id)}"><span class="music-thumb${thumb ? '' : ' fallback'}">${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : '♪'}</span><span class="music-play" data-note-play data-id="${escapeHtml(id)}" aria-label="Preview">▶</span><span class="music-meta"><b>${escapeHtml(t.title)}</b><em>${escapeHtml(t.artist)} · ${escapeHtml(t.genre)}</em></span><span class="music-tag">${escapeHtml(t.source || 'Music')}</span><span class="music-use">Use</span></button>`;
      }).join('')
    : `<p class="music-empty">${escapeHtml(emptyMsg || 'No tracks match your search.')}</p>`;
  list.querySelectorAll('.music-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.music-play').addEventListener('click', (e) => {
      e.stopPropagation();
      const track = findTrack(id);
      if (track) notePlay(track, e.currentTarget);
    });
    row.addEventListener('click', () => {
      const track = findTrack(id);
      if (!track) return;
      noteState.composerMusic = track;
      document.getElementById('note-music-title').textContent = track.title;
      document.getElementById('note-music-artist').textContent = `${track.artist} · ${track.genre}`;
      const chipBtn = document.getElementById('note-music-play');
      chipBtn.dataset.id = track.url || '';
      const trimRow = document.getElementById('note-trim-row');
      if (trimRow) {
        const startInput = document.getElementById('note-trim-start');
        const lenInput = document.getElementById('note-trim-len');
        startInput.value = (typeof track.start === 'number' && track.duration > 0) ? track.start : 0;
        lenInput.value = (typeof track.duration === 'number' && track.duration > 0) ? track.duration : 30;
        trimRow.hidden = false;
        applyTrim();
      }
      document.getElementById('note-music-row').hidden = false;
      document.getElementById('music-library').hidden = true;
      noteStop();
    });
  });
}

async function searchAppleMusic(query) {
  const res = await fetch(`https://itunes.apple.com/search?media=music&limit=20&term=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Apple Music search unavailable');
  const data = await res.json();
  return (data.results || []).filter((r) => r.previewUrl).map((r) => ({
    title: r.trackName,
    artist: r.artistName,
    genre: r.primaryGenreName || 'Music',
    url: r.previewUrl,
    art: r.artworkUrl100,
    source: 'Apple Music'
  }));
}

async function searchDeezer(query) {
  const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=20`);
  if (!res.ok) throw new Error('Deezer search unavailable');
  const data = await res.json();
  return (data.data || []).filter((t) => t.preview).map((t) => ({
    title: t.title,
    artist: (t.artist && t.artist.name) || 'Unknown',
    genre: 'Deezer',
    url: t.preview,
    art: (t.album && t.album.cover_small) || '',
    source: 'Deezer'
  }));
}

async function searchWeb(query, list) {
  list.innerHTML = '<p class="music-empty">Searching the web…</p>';
  const sources = [searchAppleMusic(query), searchDeezer(query)];
  const settled = await Promise.allSettled(sources);
  const tracks = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  tracks.forEach((t) => { if (t.url) noteState.trackCache[t.url] = t; });
  renderTrackRows(tracks.slice(0, 30), list, 'No web results for that search.');
}

function renderMusicLibrary() {
  const q = (document.getElementById('music-search').value || '').trim();
  const list = document.getElementById('music-list');
  if (q) {
    clearTimeout(ytSearchTimer);
    ytSearchTimer = setTimeout(() => searchWeb(q, list), 350);
    return;
  }
  renderTrackRows([], list, 'Search any song, artist, or genre to add music.');
}

function openNoteComposer() {
  buildNotesUi();
  document.getElementById('note-composer').hidden = false;
  document.querySelector('#note-composer .note-text').focus();
}

function openNoteViewer(index) {
  buildNotesUi();
  const note = userNotes[index];
  if (!note) return;
  noteState.viewerIndex = index;
  document.getElementById('viewer-avatar').src = note.avatar;
  document.getElementById('viewer-author').textContent = note.author;
  document.getElementById('viewer-text').textContent = note.text;
  const musicRow = document.getElementById('viewer-music');
  if (note.music && note.music.url) {
    document.getElementById('viewer-music-title').textContent = note.music.title;
    document.getElementById('viewer-music-artist').textContent = `${note.music.artist} · ${note.music.genre}`;
    document.getElementById('viewer-play').textContent = '▶';
    document.getElementById('viewer-play').dataset.id = note.music.url;
    let meta = `${note.music.artist} · ${note.music.genre}`;
    if (typeof note.music.start === 'number' && typeof note.music.duration === 'number' && note.music.duration > 0) {
      meta += ` · ✂ ${fmtTime(note.music.start)}–${fmtTime(note.music.start + note.music.duration)}`;
    }
    document.getElementById('viewer-music-artist').textContent = meta;
    musicRow.hidden = false;
  } else {
    musicRow.hidden = true;
  }
  document.getElementById('note-delete').hidden = note.author !== profile.username;
  document.getElementById('note-viewer').hidden = false;
}

function renderNoteShelves() {
  noteState.containers.forEach((container) => {
    container.innerHTML = `<button type="button" class="note-bubble note-add" aria-label="Create a note"><span class="note-ring"><b>＋</b></span><span class="note-label">Note</span></button>${userNotes.map((n, i) => `<button type="button" class="note-bubble" data-note-index="${i}" aria-label="Open ${escapeHtml(n.author)}'s note"><span class="note-ring ${n.music ? 'live' : ''}"><img src="${n.avatar}" alt="${escapeHtml(n.author)}"></span><span class="note-label">${escapeHtml(n.text.slice(0, 14))}</span></button>`).join('')}`;
    container.querySelector('.note-add').addEventListener('click', openNoteComposer);
    container.querySelectorAll('[data-note-index]').forEach((b) => b.addEventListener('click', () => openNoteViewer(Number(b.dataset.noteIndex))));
  });
}

function attachNotes(containerId) {
  buildNotesUi();
  const container = document.getElementById(containerId);
  if (!container) return;
  noteState.containers.add(container);
  renderNoteShelves();
}

// ---------- Profile tabs (Posts / Reels / Tagged / Saved) ----------
function attachProfileTabs() {
  const tabs = document.querySelectorAll('.profile-tab');
  const grid = document.querySelector('.profile-grid');
  if (!tabs.length || !grid) return;
  tabs.forEach((tab) => {
    tab.addEventListener('click', async () => {
      tabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const label = (tab.getAttribute('aria-label') || 'posts').toLowerCase();
      grid.setAttribute('aria-label', label);
      if (label === 'saved') {
        grid.innerHTML = '<p class="profile-empty">Loading saved…</p>';
        const saved = DB ? await DB.loadSaved() : [];
        if (!saved.length) {
          grid.innerHTML = '<p class="profile-empty">Nothing saved yet — tap the bookmark on any Glitch to keep it here.</p>';
          return;
        }
        grid.innerHTML = saved.map((s) => `<img class="saved-thumb" src="${s.poster || s.url}" alt="${escapeHtml(s.title || 'Saved video')}" loading="lazy">`).join('');
      }
      // Posts / Reels / Tagged keep the static grid already in the HTML
    });
  });
}

// ---------- Page dispatch ----------
// Live viewing page: simulated chat stream, ticking viewer count, floating
// heart reactions, comment posting, and badge purchases.
function attachLive() {
  const chat = document.getElementById('live-chat');
  const hearts = document.getElementById('live-hearts');
  const viewers = document.getElementById('live-viewers');
  const form = document.getElementById('live-comment-form');
  const buyBtn = document.getElementById('live-buy');
  const heartBtn = document.getElementById('live-heart-btn');
  const player = document.getElementById('live-player');

  // ----- viewer count ticker -----
  let viewersCount = 1537;
  const fmtCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const renderViewers = () => {
    if (!viewers) return;
    viewers.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${fmtCount(viewersCount)}`;
  };
  renderViewers();
  setInterval(() => {
    viewersCount += Math.round(1 + Math.random() * 6);
    renderViewers();
  }, 5000);

  // ----- floating hearts -----
  const spawnHeart = (xPct) => {
    if (!hearts) return;
    const h = document.createElement('span');
    h.className = 'live-heart';
    h.textContent = '♡';
    h.style.left = `${xPct}%`;
    hearts.appendChild(h);
    h.addEventListener('animationend', () => h.remove());
  };
  setInterval(() => spawnHeart(58 + Math.random() * 32), 1500);
  heartBtn?.addEventListener('click', () => {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => spawnHeart(60 + Math.random() * 28), i * 140);
    }
  });
  // Double-tap the video to drop a heart at that spot (like an interaction).
  player?.addEventListener('dblclick', (e) => {
    if (isGuest()) { showGuestGate('Sign in to like'); return; }
    const rect = player.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    if (!hearts) return;
    const h = document.createElement('span');
    h.className = 'live-heart live-heart-tap';
    h.textContent = '♡';
    h.style.left = `${xPct}%`;
    h.style.top = `${yPct}%`;
    h.style.bottom = 'auto';
    hearts.appendChild(h);
    h.addEventListener('animationend', () => h.remove());
  });

  // ----- simulated chat stream -----
  const names = ['mira.motion', 'kicksbyte', 'chantouflowergirl', 'glitchwear', 'pixelmakers', 'duskdrift'];
  const lines = [
    'this fit is everything 🔥',
    'yasss queen 👏',
    'just joined, hi everyone!',
    'the vibes are immaculate',
    'drop the link rn',
    'LIVE is so good today',
    'hello from Toronto 🇨🇦',
    'can we get a wave? 🙌',
  ];
  const avatars = [
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=80&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=80&q=80',
    'https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&w=80&q=80',
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=80&q=80',
    'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=80&q=80',
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=80&q=80',
  ];
  const addMsg = (name, text) => {
    if (!chat) return;
    const row = document.createElement('div');
    row.className = 'live-msg';
    row.innerHTML = `<img src="${avatars[Math.floor(Math.random() * avatars.length)]}" alt="" loading="lazy"><span><b>${escapeHtml(name)}</b> ${escapeHtml(text)}</span>`;
    chat.appendChild(row);
    while (chat.children.length > 4) chat.removeChild(chat.firstChild);
  };
  setInterval(() => {
    addMsg(names[Math.floor(Math.random() * names.length)], lines[Math.floor(Math.random() * lines.length)]);
  }, 5200);

  // ----- comment posting -----
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('live-comment-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    const user = window.GLITCHIT_USER;
    const me = (user && !user.guest && user.user_metadata?.username) || user?.email?.split('@')[0] || 'you';
    addMsg(me, text);
    if (input) input.value = '';
  });

  // ----- badge purchase -----
  buyBtn?.addEventListener('click', () => {
    const tip = document.createElement('div');
    tip.className = 'end-toast show';
    tip.innerHTML = `<span class="end-toast-mark">${icon('🏆')}</span><span class="end-toast-text">Badge purchased — thanks for supporting charleeatkins!</span>`;
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), 2200);
  });
}

function runPage() {
  attachThemeToggle();
  attachEndOfPageDetection();

  if (page === 'home') {
    const feedTarget = document.getElementById('upload-feed');
    if (feedTarget) feedTarget.innerHTML = renderUploads('feed');
    if (DB) {
      DB.loadMedia('image').then((rows) => {
        if (!rows.length || !feedTarget) return;
        const cards = rows.map((r) => uploadCard({ preview: r.url, title: r.title, caption: r.caption, type: 'image', user: displayUser(r.user), avatar: r.avatar }, 'feed')).join('');
        feedTarget.insertAdjacentHTML('afterbegin', cards);
      });
    }
    hydrateStoryShelf();
    attachNotes('home-notes');
  }
  if (page === 'glitches') {
    const videoTarget = document.getElementById('video-feed');
    if (videoTarget) videoTarget.innerHTML = renderUploads('videos');
    if (DB) {
      DB.loadMedia('video').then((rows) => {
        if (!rows.length || !videoTarget) return;
        const cards = rows.map((r) => glitchVideoCard({ id: r.id, title: r.title, caption: r.caption, src: r.url, poster: r.poster || r.url, user: displayUser(r.user), avatar: r.avatar, likes: String(r.likes || 0), comments: String(r.comments || 0), shares: String(r.shares || 0) })).join('');
        videoTarget.insertAdjacentHTML('afterbegin', cards);
        attachReelsActions();
        attachGlitchAutoplay();
      });
    }
    attachGlitchAutoplay();
    attachReelsActions();
    markSavedReels();
  }
  if (page === 'create') attachCreateStudio();
  if (page === 'live') attachLive();
  if (page === 'profile') {
    attachSettingsDrawer();
    attachProfileTabs();
    attachProfileAuth();
    document.getElementById('share-song')?.addEventListener('click', () => openNoteComposer());
    document.getElementById('share-profile')?.addEventListener('click', () => {
      const url = location.href;
      if (navigator.share) { navigator.share({ title: 'GlitchIt profile', url }).catch(() => {}); return; }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          const tip = document.createElement('div');
          tip.className = 'end-toast show';
          tip.textContent = 'Profile link copied';
          document.body.appendChild(tip);
          setTimeout(() => tip.remove(), 2000);
        }).catch(() => {});
      }
    });
  }
  if (page === 'shop') { attachShopTabs(); attachShopFilters(); attachStoryLinks(); attachGlitchAutoplay(); }

  attachGuestGuards();
  window.addEventListener('scroll', updateGlitchPlayback, { passive: true });
}

// ---------- Supabase auth bootstrap ----------
const GUEST_KEY = 'glitchit.auth.guest.v1'; // guest browsing flag
const ACCOUNT_PAGES = ['messages', 'chat', 'profile', 'create', 'shop'];

// Interactions guests cannot perform on browsable pages.
const GUEST_GATED_SELECTOR = [
  '.reel-like', '.reel-follow', '.reel-save', '.reel-action',
  '.comment-box', '.text-button',
  '.post .actions',
  '.seller button',
  '.note-add',
  '#create-form', '#capture-btn',
  '.live-comment-form', '.live-buy', '.live-heart-btn',
].join(',');

let guestGateToast = null;

function isGuest() {
  return Boolean(window.GLITCHIT_USER && window.GLITCHIT_USER.guest);
}

// Show a "sign in" toast, then route the guest to the auth page.
function showGuestGate(msg) {
  if (!guestGateToast) {
    guestGateToast = document.createElement('div');
    guestGateToast.className = 'end-toast show';
    guestGateToast.setAttribute('role', 'status');
    document.body.appendChild(guestGateToast);
  }
  guestGateToast.innerHTML = `<span class="end-toast-mark">${icon('ϟ')}</span><span class="end-toast-text">${escapeHtml(msg)}</span>`;
  clearTimeout(showGuestGate._t);
  showGuestGate._t = setTimeout(() => {
    location.href = `auth.html?returnTo=${encodeURIComponent(location.pathname.split('/').pop() || 'index.html')}`;
  }, 1400);
}

// Block account-only interactions for guests: like, comment, share, follow,
// save, and posting; plus navigation into account-only pages.
function attachGuestGuards() {
  if (!isGuest()) return;
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href$=".html"]');
    if (link) {
      const href = link.getAttribute('href') || '';
      if (ACCOUNT_PAGES.some((p) => href === `${p}.html`)) {
        event.preventDefault();
        showGuestGate('Sign in to open this page');
        return;
      }
    }
    const locked = event.target.closest(GUEST_GATED_SELECTOR);
    if (!locked) return;
    event.preventDefault();
    event.stopPropagation();
    showGuestGate('Sign in to like, comment, follow, share & post');
  }, true);
  document.addEventListener('submit', (event) => {
    if (event.target.closest('.comment-box') || event.target.closest('#create-form')) {
      event.preventDefault();
      showGuestGate('Sign in to comment & post');
    }
  }, true);
}

// Guests may browse read-only, but every account action (follow, like,
// comment, share, post, messages, profile, create, shop) requires sign-in.
function attachAuthPage(auth) {
  const form = document.getElementById('auth-form');
  if (!form || !auth) return;
  const tabs = [...document.querySelectorAll('.auth-tab')];
  const usernameField = document.getElementById('auth-username-field');
  const errorEl = document.getElementById('auth-error');
  const submit = document.getElementById('auth-submit');
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    tabs.forEach((t) => {
      const on = t.dataset.authMode === m;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (usernameField) usernameField.hidden = m !== 'signup';
    if (submit) submit.textContent = m === 'signup' ? 'Sign up' : 'Log in';
    if (errorEl) errorEl.hidden = true;
  };
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.authMode)));
  document.getElementById('auth-toggle-password')?.addEventListener('click', (e) => {
    const input = document.getElementById('auth-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? '\U0001F647' : '\U0001F441';
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  document.getElementById('auth-guest')?.addEventListener('click', () => {
    try { localStorage.setItem(GUEST_KEY, '1'); } catch (err) { /* storage unavailable */ }
    location.href = returnToPage() || 'index.html';
  });
  const showError = (msg) => { if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; } };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const username = (document.getElementById('auth-username')?.value || '').trim();
    if (!email || !password) { showError('Enter your email and password.'); return; }
    if (submit) { submit.disabled = true; submit.textContent = 'Please wait\u2026'; }
    const res = mode === 'signup'
      ? await auth.signUp(email, password, username)
      : await auth.signIn(email, password);
    if (submit) { submit.disabled = false; submit.textContent = mode === 'signup' ? 'Sign up' : 'Log in'; }
    if (!res.ok) { showError(res.error || 'Something went wrong.'); return; }
    try { localStorage.removeItem(GUEST_KEY); } catch (err) { /* ignore */ }
    window.GLITCHIT_USER = res.user;
    auth.setHandle(auth.userHandle(res.user));
    import('./db.js?v=3').then((db) => db.setCurrentUser?.({ id: res.user.id, username: auth.userHandle(res.user) })).catch(() => {});
    location.href = returnToPage() || 'index.html';
  });
}

// Profile page: reflect the signed-in user and wire the Log out button.
function attachProfileAuth() {
  const user = window.GLITCHIT_USER;
  const logoutBtn = document.getElementById('auth-logout');
  if (logoutBtn) {
    logoutBtn.textContent = (user && user.guest) ? 'Exit guest mode' : 'Log out';
    logoutBtn.addEventListener('click', async () => {
      const auth = window.GLITCHIT_AUTH;
      if (auth) await auth.signOut();
      window.GLITCHIT_USER = null;
      try { localStorage.removeItem(GUEST_KEY); } catch (err) { /* ignore */ }
      location.href = 'auth.html';
    });
  }
  if (!user || user.guest) return;
  const handle = user.user_metadata?.username || user.email?.split('@')[0] || '';
  const top = document.querySelector('.profile-topbar strong');
  if (top && handle) top.textContent = handle;
  const nameEl = document.querySelector('.profile-name');
  if (nameEl && handle) {
    nameEl.innerHTML = `${escapeHtml(handle)} <span class="pronouns">${escapeHtml(user.email || '')}</span>`;
  }
  const me = document.querySelector('.me strong');
  if (me && handle) me.textContent = handle;
}

// Check whether this device is signed in before showing any app page.
async function boot() {
  const isAuthPage = page === 'auth';
  let auth = null;
  try { auth = await import('./auth.js?v=3'); } catch (err) { auth = null; }
  window.GLITCHIT_AUTH = auth;
  let guest = false;
  try { guest = localStorage.getItem(GUEST_KEY) === '1'; } catch (err) { /* ignore */ }
  const dbReady = async () => {
    if (DB) return DB;
    try { return await import('./db.js?v=3'); } catch (err) { return null; }
  };
  if (auth && auth.authAvailable()) {
    if (isAuthPage) {
      // Already signed in? Skip the form and go straight to the app.
      const user = await auth.currentUser();
      if (user) {
        window.GLITCHIT_USER = user;
        auth.setHandle(auth.userHandle(user));
        const db = await dbReady();
        db?.setCurrentUser?.({ id: user.id, username: auth.userHandle(user) });
        location.replace(returnToPage() || 'index.html');
        return;
      }
      attachAuthPage(auth);
    } else {
      const user = await auth.currentUser();
      if (user) {
        // Signed in — full access.
        window.GLITCHIT_USER = user;
        auth.setHandle(auth.userHandle(user));
        const db = await dbReady();
        db?.setCurrentUser?.({ id: user.id, username: auth.userHandle(user) });
      } else if (guest) {
        // Guest browsing: view-only. Account-only pages redirect to sign-in.
        window.GLITCHIT_USER = { guest: true };
        if (ACCOUNT_PAGES.includes(page)) {
          location.replace(`auth.html?returnTo=${encodeURIComponent(location.pathname.split('/').pop() || 'index.html')}`);
          return;
        }
        const db = await dbReady();
        db?.setCurrentUser?.('');
      } else {
        location.replace(`auth.html?returnTo=${encodeURIComponent(location.pathname.split('/').pop() || 'index.html')}`);
        return;
      }
    }
  }
  runPage();
}

boot();
