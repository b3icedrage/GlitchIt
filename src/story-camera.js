// GlitchIt — story camera (camera.html).
// Self-contained page script: live viewfinder, filters, photo capture,
// boomerang recording, draggable text, hands-free timer, and story saving
// through the shared Supabase data layer (src/db.js).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    video: $('cam-video'), canvas: $('cam-canvas'), grid: $('cam-grid'),
    off: $('cam-off'), offMsg: $('cam-off-msg'), offRetry: $('cam-off-retry'), offGallery: $('cam-off-gallery'),
    dismiss: $('cam-dismiss'), flash: $('cam-flash'), settings: $('cam-settings'),
    menu: $('cam-menu'), trigger: $('cam-trigger'), menuClose: $('cam-menu-close'),
    gallery: $('cam-gallery'), shutter: $('cam-shutter'), filters: $('cam-filters'),
    refresh: $('cam-refresh'), reelTimer: $('cam-reel-timer'), reelTime: $('cam-reel-time'),
    preview: $('cam-preview'), previewImg: $('cam-preview-img'), previewVideo: $('cam-preview-video'),
    textLayers: $('cam-text-layers'), previewTitle: $('cam-preview-title'),
    saveTo: $('cam-save-to'), saveTarget: $('cam-save-target'), previewBack: $('cam-preview-back'),
    textTool: $('cam-text-tool'), previewSettings: $('cam-preview-settings'), save: $('cam-save'),
    composer: $('cam-composer'), composerInput: $('cam-composer-input'),
    composerColors: $('cam-composer-colors'), composerSize: $('cam-composer-size'), composerDone: $('cam-composer-done'),
    countdown: $('cam-countdown'),
    sheet: $('cam-sheet'), sheetClose: $('cam-sheet-close'),
    setFlip: $('cam-set-flip'), setGrid: $('cam-set-grid'), setFlash: $('cam-set-flash'), setTimer: $('cam-set-timer'),
    toast: $('cam-toast'), file: $('cam-file'),
  };

  // Instagram-style filter presets (CSS filter strings, applied live and baked).
  const FILTERS = [
    { name: 'Normal', css: 'none' },
    { name: 'Clarendon', css: 'contrast(1.2) saturate(1.35)' },
    { name: 'Gingham', css: 'brightness(1.05) contrast(1.1) sepia(.1)' },
    { name: 'Moon', css: 'grayscale(1) contrast(1.1) brightness(.95)' },
    { name: 'Lark', css: 'brightness(1.02) contrast(.95) saturate(.9) sepia(.08)' },
    { name: 'Reyes', css: 'sepia(.22) brightness(1.11) contrast(.85) saturate(.75)' },
    { name: 'Juno', css: 'sepia(.35) contrast(1.15) saturate(1.2) brightness(1.05)' },
    { name: 'Slumber', css: 'sepia(.35) contrast(1.05) saturate(.75) brightness(.9)' },
    { name: 'Crema', css: 'sepia(.5) contrast(.9) brightness(1.1)' },
    { name: 'Ludwig', css: 'saturate(1.25) contrast(1.05) brightness(1.05)' },
    { name: 'Aden', css: 'sepia(.2) brightness(1.15) saturate(.85) contrast(.9)' },
    { name: 'Perpetua', css: 'contrast(1.1) brightness(1.05) saturate(.9) sepia(.1)' },
  ];
  const TEXT_COLORS = ['#ffffff', '#000000', '#ff3040', '#0095f6', '#ffd60a', '#37e237', '#ff5ce1', 'rainbow'];
  const STORY_RATIO = { w: 1080, h: 1440 }; // 9:16 story canvas
  const TIMERS = [3, 5, 10];

  let stream = null;
  let facing = 'user';
  let flash = 'off';
  let filterIdx = 0;
  let tool = 'create'; // create | boomerang | layout | hands
  let mode = 'story';  // story | reel — which the mode bar is in
  let gridOn = false;
  let handsFree = false;
  let timerIdx = 0;
  let textLayers = []; // { id, text, color, size, x, y } — x/y normalized 0..1
  let preview = null;  // { kind: 'image'|'video', url, blob?, poster?, canvas? }
  let curColor = '#ffffff';
  let recording = false;
  let auth = null;
  let db = null;
  let user = null;

  // ---------- small helpers ----------
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  let toastTimer = null;
  function toast(msg, ms = 2400) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  // Cover-fit draw (video frames or <img>) into W×H with the active filter baked.
  function drawCover(ctx, src, W, H) {
    const sw = src.videoWidth || src.naturalWidth || W;
    const sh = src.videoHeight || src.naturalHeight || H;
    const s = Math.max(W / sw, H / sh);
    ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
  }

  // ---------- auth + data layer ----------
  async function boot() {
    try { auth = await import('./auth.js?v=3'); } catch (e) { auth = null; }
    if (auth && auth.authAvailable()) {
      try { user = await auth.currentUser(); } catch (e) { user = null; }
      if (user) {
        window.GLITCHIT_USER = user;
        try { auth.setHandle(auth.userHandle(user)); } catch (e) { /* ok */ }
      }
    }
    try { db = await import('./db.js?v=3'); } catch (e) { db = null; }
    if (db && user) db.setCurrentUser({ id: user.id, username: auth.userHandle(user) });
    startCamera();
  }

  // ---------- camera ----------
  function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  function showOff(msg) {
    els.off.hidden = false;
    els.offMsg.textContent = msg;
  }
  async function startCamera() {
    stopStream();
    els.video.style.transform = '';
    els.video.style.filter = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      showOff('Camera access is unavailable in this browser.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1920 } },
        audio: false,
      });
      els.video.srcObject = stream;
      els.video.muted = true;
      await els.video.play();
      if (facing === 'user') els.video.style.transform = 'scaleX(-1)';
      els.off.hidden = true;
      setVideoFilter();
      applyTorch();
    } catch (err) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow access in your browser and try again.'
        : err?.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'Could not access your camera.';
      showOff(msg);
    }
  }
  function setVideoFilter() {
    els.video.style.filter = FILTERS[filterIdx].css;
  }
  function applyTorch() {
    const track = stream?.getVideoTracks?.()[0];
    if (!track || typeof track.applyConstraints !== 'function') return;
    const on = flash === 'on' && facing === 'environment';
    track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
  }
  function setFlash(next) {
    flash = next;
    els.flash.dataset.state = flash;
    els.flash.setAttribute('aria-label', `Flash ${flash}`);
    applyTorch();
    syncSheet();
  }

  // ---------- filter chips ----------
  els.filters.innerHTML = FILTERS.map((f, i) =>
    `<button type="button" class="cam-filter${i === 0 ? ' active' : ''}" data-filter="${i}" role="option" aria-selected="${i === 0}" aria-label="${f.name} filter"><span class="cam-filter-dot">${f.name[0]}</span><span>${f.name}</span></button>`
  ).join('');
  els.filters.addEventListener('click', (e) => {
    const btn = e.target.closest('.cam-filter');
    if (!btn) return;
    filterIdx = Number(btn.dataset.filter);
    els.filters.querySelectorAll('.cam-filter').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    setVideoFilter();
  });

  // ---------- create tools menu ----------
  const menuItems = [...document.querySelectorAll('.cam-menu-item[data-tool]')];
  function openMenu(open) {
    els.menu.hidden = !open;
    els.trigger.classList.toggle('is-open', open);
    els.trigger.setAttribute('aria-expanded', String(open));
  }
  els.trigger.addEventListener('click', () => openMenu(els.menu.hidden));
  els.menuClose.addEventListener('click', () => openMenu(false));
  menuItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tool;
      if (t === 'boomerang') {
        tool = 'boomerang';
        toast('Boomerang — tap to record a loop');
      } else if (t === 'hands') {
        handsFree = !handsFree;
        btn.classList.toggle('is-current', handsFree);
        toast(handsFree ? `Hands-free on — ${TIMERS[timerIdx]}s timer` : 'Hands-free off');
      } else if (t === 'layout') {
        gridOn = !gridOn;
        els.grid.hidden = !gridOn;
        btn.classList.toggle('is-current', gridOn);
        toast(gridOn ? 'Grid lines on' : 'Grid lines off');
        syncSheet();
      } else {
        tool = 'create';
      }
      openMenu(false);
    });
  });

  // ---------- top bar / misc ----------
  els.dismiss.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = 'index.html';
  });
  els.flash.addEventListener('click', () => {
    setFlash(flash === 'off' ? 'on' : flash === 'on' ? 'auto' : 'off');
  });
  els.refresh.addEventListener('click', () => {
    stopStream();
    location.reload();
  });
  function setMode(m) {
    mode = m;
    document.querySelectorAll('.cam-modes [data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === m);
    });
    els.shutter.setAttribute('aria-label', m === 'reel' ? 'Start recording a reel' : 'Take a photo');
    toast(m === 'reel' ? 'Reel mode — tap to record' : 'Story mode — tap to snap');
  }
  document.querySelectorAll('.cam-modes [data-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'post' || m === 'live') { location.href = m === 'post' ? 'index.html' : 'live.html'; return; }
      setMode(m);
    });
  });
  window.addEventListener('pagehide', () => stopStream(), { once: true });

  // ---------- shutter: photo / boomerang / hands-free ----------
  els.shutter.addEventListener('click', () => {
    if (mode === 'reel') {
      if (recording) stopReelRecording();
      else if (!stream) toast('Camera unavailable — pick from your gallery instead');
      else if (handsFree) runCountdown(startReelRecording);
      else startReelRecording();
      return;
    }
    if (recording) return;
    if (!stream) {
      toast('Camera unavailable — pick from your gallery instead');
      return;
    }
    if (tool === 'boomerang') { startBoomerang(); return; }
    if (handsFree) { runCountdown(capturePhoto); return; }
    capturePhoto();
  });

  function capturePhoto() {
    const vw = els.video.videoWidth;
    const vh = els.video.videoHeight;
    if (!vw || !vh) return;
    const { w: W, h: H } = STORY_RATIO;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.filter = FILTERS[filterIdx].css;
    drawCover(ctx, els.video, W, H);
    preview = { kind: 'image', url: c.toDataURL('image/jpeg', 0.92), canvas: c };
    openPreview('image');
  }

  // Boomerang: record ~1.6s of the filtered viewfinder via a capture-stream canvas.
  function startBoomerang() {
    const vw = els.video.videoWidth || 720;
    const vh = els.video.videoHeight || 1280;
    const W = 720;
    const H = 1280;
    els.canvas.width = W;
    els.canvas.height = H;
    const ctx = els.canvas.getContext('2d');
    ctx.filter = FILTERS[filterIdx].css;
    const render = () => drawCover(ctx, els.video, W, H);
    const capStream = els.canvas.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      .find((m) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(capStream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      recording = false;
      els.shutter.classList.remove('recording');
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      preview = { kind: 'video', url: URL.createObjectURL(blob), blob, poster: framePoster(els.video) };
      openPreview('video');
    };
    recording = true;
    els.shutter.classList.add('recording');
    let raf;
    const loop = () => { if (!recording) return; render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    rec.start();
    setTimeout(() => { try { rec.stop(); } catch (e) { /* already stopped */ } }, 1600);
  }

  // Reel mode: continuous vertical video recording (tap to start, tap to stop,
  // auto-caps at 90s) with a live timer pill.
  let reelRec = null;
  let reelRaf = 0;
  let reelTimerInt = 0;
  let reelStart = 0;
  const REEL_MAX = 90;

  function startReelRecording() {
    const vw = els.video.videoWidth || 720;
    const vh = els.video.videoHeight || 1280;
    const W = 720;
    const H = 1280;
    els.canvas.width = W;
    els.canvas.height = H;
    const ctx = els.canvas.getContext('2d');
    ctx.filter = FILTERS[filterIdx].css;
    const render = () => drawCover(ctx, els.video, W, H);
    const capStream = els.canvas.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      .find((m) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(capStream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      cancelAnimationFrame(reelRaf);
      clearInterval(reelTimerInt);
      recording = false;
      els.shutter.classList.remove('recording');
      els.reelTimer.hidden = true;
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      preview = { kind: 'video', url: URL.createObjectURL(blob), blob, poster: framePoster(els.video) };
      openPreview('video');
    };
    recording = true;
    reelRec = rec;
    els.shutter.classList.add('recording');
    els.reelTimer.hidden = false;
    reelStart = Date.now();
    els.reelTime.textContent = '0:00';
    reelTimerInt = setInterval(() => {
      const sec = Math.min(REEL_MAX, Math.floor((Date.now() - reelStart) / 1000));
      els.reelTime.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      if (sec >= REEL_MAX) stopReelRecording();
    }, 250);
    const loop = () => { if (!recording) return; render(); reelRaf = requestAnimationFrame(loop); };
    reelRaf = requestAnimationFrame(loop);
    rec.start();
    toast('Recording… tap the shutter to stop');
  }

  function stopReelRecording() {
    if (!reelRec) return;
    try { reelRec.stop(); } catch (e) { /* already stopped */ }
    reelRec = null;
  }

  // First frame of a video source as a small JPEG poster (for the story ring).
  function framePoster(src, w = 540, h = 960) {
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.filter = FILTERS[filterIdx].css;
      drawCover(ctx, src, w, h);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      return '';
    }
  }

  function runCountdown(cb) {
    let n = TIMERS[timerIdx];
    const num = els.countdown.querySelector('b');
    num.textContent = String(n);
    els.countdown.hidden = false;
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
    const tick = () => {
      n -= 1;
      if (n <= 0) { els.countdown.hidden = true; cb(); return; }
      num.textContent = String(n);
      num.style.animation = 'none';
      void num.offsetWidth;
      num.style.animation = '';
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  // ---------- preview ----------
  function openPreview(kind) {
    if (!preview) return;
    els.preview.hidden = false;
    const isImage = kind === 'image';
    els.previewImg.hidden = !isImage;
    els.previewVideo.hidden = isImage;
    els.textTool.style.visibility = isImage ? 'visible' : 'hidden';
    els.previewImg.src = isImage ? preview.url : '';
    els.previewVideo.src = isImage ? '' : preview.url;
    els.previewVideo.poster = preview.poster || '';
    textLayers = [];
    renderTextLayers();
    updateSaveLabel();
    if (!isImage) els.previewVideo.play().catch(() => {});
  }
  els.previewBack.addEventListener('click', closePreview);
  els.previewSettings.addEventListener('click', () => { els.sheet.hidden = false; syncSheet(); });
  els.previewVideo.addEventListener('loadeddata', () => {
    // Gallery-picked videos get a poster frame so the story ring has a thumb.
    if (preview && preview.kind === 'video' && !preview.poster && els.previewVideo.videoWidth) {
      preview.poster = framePoster(els.previewVideo);
    }
  });
  function closePreview() {
    els.preview.hidden = true;
    if (preview && preview.kind === 'video' && preview.url.startsWith('blob:')) URL.revokeObjectURL(preview.url);
    textLayers = [];
    els.previewImg.src = '';
    els.previewVideo.src = '';
    els.textLayers.innerHTML = '';
    preview = null;
    els.save.disabled = false;
    els.save.classList.remove('busy');
    updateSaveLabel();
  }

  // The save pill + preview title adapt to the chosen mode (story vs reel).
  function updateSaveLabel() {
    const isReel = mode === 'reel';
    els.previewTitle.textContent = isReel ? 'Your reel' : 'Your story';
    els.saveTo.textContent = isReel ? 'Share to' : 'Send to';
    els.saveTarget.textContent = isReel ? 'Your reel' : 'Your story';
  }

  // ---------- text overlays ----------
  els.textTool.addEventListener('click', () => {
    els.composer.hidden = false;
    els.composerInput.value = '';
    els.composerInput.focus();
  });
  els.composerDone.addEventListener('click', () => {
    const text = els.composerInput.value.trim();
    els.composer.hidden = true;
    if (!text) return;
    textLayers.push({ id: 't' + Date.now(), text, color: curColor, size: Number(els.composerSize.value) || 44, x: 0.5, y: 0.4 });
    renderTextLayers();
  });
  els.composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.composerDone.click();
  });

  els.composerColors.innerHTML = TEXT_COLORS.map((c, i) => {
    const style = c === 'rainbow'
      ? 'background:linear-gradient(90deg,#ff004c,#ff9000,#ffd60a,#44d62c,#00c2ff,#8f5bff)'
      : `background:${c}`;
    return `<button type="button" class="cam-color${i === 0 ? ' active' : ''}" data-color="${c}" style="${style}" role="radio" aria-checked="${i === 0}" aria-label="${c === 'rainbow' ? 'Rainbow' : c} text color"></button>`;
  }).join('');
  els.composerColors.addEventListener('click', (e) => {
    const sw = e.target.closest('.cam-color');
    if (!sw) return;
    curColor = sw.dataset.color;
    els.composerColors.querySelectorAll('.cam-color').forEach((b) => {
      const on = b === sw;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  });

  function renderTextLayers() {
    els.textLayers.innerHTML = '';
    textLayers.forEach((layer) => {
      const div = document.createElement('div');
      div.className = 'cam-text-layer';
      div.dataset.id = layer.id;
      div.style.left = `${layer.x * 100}%`;
      div.style.top = `${layer.y * 100}%`;
      div.style.fontSize = `${layer.size}px`;
      const innerColor = layer.color === 'rainbow' ? '#fff' : layer.color;
      div.innerHTML = `<span class="cam-text-inner${layer.color === 'rainbow' ? ' rainbow' : ''}" style="color:${innerColor}">${escapeHtml(layer.text)}</span><button type="button" class="cam-text-del" data-del="${layer.id}" aria-label="Remove text">✕</button>`;
      els.textLayers.appendChild(div);
    });
    els.textLayers.querySelectorAll('.cam-text-layer').forEach((div) => {
      const layer = textLayers.find((t) => t.id === div.dataset.id);
      if (!layer) return;
      div.querySelector('.cam-text-del').addEventListener('click', (e) => {
        e.stopPropagation();
        textLayers = textLayers.filter((t) => t.id !== layer.id);
        renderTextLayers();
      });
      div.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.cam-text-del')) return;
        e.preventDefault();
        div.classList.add('dragging');
        div.setPointerCapture(e.pointerId);
        const rect = els.textLayers.getBoundingClientRect();
        const move = (ev) => {
          layer.x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
          layer.y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
          div.style.left = `${layer.x * 100}%`;
          div.style.top = `${layer.y * 100}%`;
        };
        const up = () => {
          div.classList.remove('dragging');
          div.removeEventListener('pointermove', move);
          div.removeEventListener('pointerup', up);
          div.removeEventListener('pointercancel', up);
        };
        div.addEventListener('pointermove', move);
        div.addEventListener('pointerup', up);
        div.addEventListener('pointercancel', up);
      });
    });
  }

  // Bake the image + text overlays into the 1080×1440 story canvas.
  function bakeImage() {
    const c = preview.canvas;
    const ctx = c.getContext('2d');
    const stage = els.textLayers.getBoundingClientRect();
    const sx = STORY_RATIO.w / stage.width;
    const sy = STORY_RATIO.h / stage.height;
    textLayers.forEach((l) => {
      ctx.save();
      const px = l.x * STORY_RATIO.w;
      const py = l.y * STORY_RATIO.h;
      const size = l.size * sx;
      ctx.font = `900 ${size}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(4, size * 0.12);
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(l.text, px, py);
      if (l.color === 'rainbow') {
        const g = ctx.createLinearGradient(px - 220 * sx, py, px + 220 * sx, py);
        ['#ff004c', '#ff9000', '#ffd60a', '#44d62c', '#00c2ff', '#8f5bff'].forEach((col, i) => g.addColorStop(i / 5, col));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = l.color;
      }
      ctx.fillText(l.text, px, py);
      ctx.restore();
    });
    return c;
  }

  // ---------- save ----------
  els.save.addEventListener('click', async () => {
    if (!preview) return;
    if (!user) {
      toast(mode === 'reel' ? 'Sign in to share your reel' : 'Sign in to share your story');
      setTimeout(() => { location.href = 'auth.html?returnTo=camera.html'; }, 1300);
      return;
    }
    if (!db) {
      toast('Saving is unavailable right now — try again soon');
      return;
    }
    const saveLabel = els.save.querySelector('b');
    els.save.disabled = true;
    els.save.classList.add('busy');
    saveLabel.textContent = 'Sharing…';
    try {
      let file;
      let poster = null;
      let kind = 'image';
      if (preview.kind === 'image') {
        file = await new Promise((res) => bakeImage().toBlob(res, 'image/jpeg', 0.92));
      } else {
        file = preview.blob;
        poster = preview.poster || null;
        kind = 'video';
      }
      const isReel = mode === 'reel';
      const handle = (user.user_metadata && user.user_metadata.username) || user.email?.split('@')[0] || '';
      const avatar = (user.user_metadata && user.user_metadata.avatar) || '';
      const res = await db.saveMedia({
        type: kind,
        kind: isReel ? 'video' : 'story',
        file,
        title: isReel ? 'Reel' : 'Story',
        caption: isReel ? 'Reel moment' : 'Story moment',
        handle,
        avatar,
      });
      if (!res.ok) throw new Error(res.reason || 'save');
      if (!isReel) {
        try {
          localStorage.setItem('glitchit.story.latest', JSON.stringify({
            url: res.url,
            poster: kind === 'video' ? poster : res.url,
            kind,
            at: Date.now(),
          }));
        } catch (e) { /* storage unavailable */ }
      }
      toast(isReel ? 'Reel shared ✦' : 'Story shared ✦');
      setTimeout(() => { location.href = isReel ? 'glitches.html' : 'index.html'; }, 900);
    } catch (err) {
      els.save.disabled = false;
      els.save.classList.remove('busy');
      updateSaveLabel();
      toast(err.message === 'table'
        ? 'Stories can’t save yet — create the media table in Supabase.'
        : 'Couldn’t share your story — please try again.');
    }
  });

  // ---------- gallery ----------
  els.gallery.addEventListener('click', () => els.file.click());
  els.offGallery.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    const f = els.file.files && els.file.files[0];
    els.file.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    if (f.type.startsWith('video')) {
      preview = { kind: 'video', url, blob: f, poster: '' };
      openPreview('video');
    } else {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = STORY_RATIO.w;
        c.height = STORY_RATIO.h;
        const ctx = c.getContext('2d');
        ctx.filter = FILTERS[filterIdx].css;
        drawCover(ctx, img, STORY_RATIO.w, STORY_RATIO.h);
        URL.revokeObjectURL(url);
        preview = { kind: 'image', url: c.toDataURL('image/jpeg', 0.92), canvas: c };
        openPreview('image');
      };
      img.onerror = () => toast('Couldn’t read that image');
      img.src = url;
    }
  });

  // ---------- settings sheet ----------
  function syncSheet() {
    els.setFlip.textContent = facing === 'user' ? 'Front' : 'Back';
    els.setGrid.classList.toggle('on', gridOn);
    els.setGrid.setAttribute('aria-checked', String(gridOn));
    els.setFlash.textContent = flash === 'off' ? 'Off' : flash === 'on' ? 'On' : 'Auto';
    els.setTimer.textContent = `${TIMERS[timerIdx]}s`;
  }
  els.settings.addEventListener('click', () => { els.sheet.hidden = false; syncSheet(); });
  els.sheet.addEventListener('click', (e) => { if (e.target === els.sheet) els.sheet.hidden = true; });
  els.sheetClose.addEventListener('click', () => { els.sheet.hidden = true; });
  els.setFlip.addEventListener('click', () => {
    facing = facing === 'user' ? 'environment' : 'user';
    syncSheet();
    startCamera();
  });
  els.setGrid.addEventListener('click', () => {
    gridOn = !gridOn;
    els.grid.hidden = !gridOn;
    syncSheet();
    menuItems.find((b) => b.dataset.tool === 'layout')?.classList.toggle('is-current', gridOn);
  });
  els.setFlash.addEventListener('click', () => {
    setFlash(flash === 'off' ? 'on' : flash === 'on' ? 'auto' : 'off');
  });
  els.setTimer.addEventListener('click', () => {
    timerIdx = (timerIdx + 1) % TIMERS.length;
    syncSheet();
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.composer.hidden) { els.composer.hidden = true; return; }
    if (!els.sheet.hidden) { els.sheet.hidden = true; return; }
    if (!els.menu.hidden) { openMenu(false); return; }
    if (!els.preview.hidden) closePreview();
    else els.dismiss.click();
  });

  boot();
})();
