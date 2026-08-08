// GlitchIt — real camera for the "New story" form.
//
// Replaces the old static mock form (a placeholder "Captured preview" box) with
// a real camera: users see themselves live (mirrored selfie view), can take a
// photo or record a video, then land on a share sheet (caption, location,
// share-to-feed, save draft, publish).
//
// Captures are fed into the studio's existing state pipeline by dispatching a
// change event on the hidden #media-upload-input (attachCreateStudio() in
// src/main.js already ingests image/video files into its `state`), so the
// publish handler keeps working untouched. Videos restore the user's chosen
// tab (main.js forces the REEL tab when a video file is ingested).
(function () {
  'use strict';
  if (document.body.dataset.page !== 'create') return;
  const form = document.getElementById('create-form');
  if (!form) return;

  const cam = document.getElementById('fc-cam');
  const feed = document.getElementById('fc-feed');
  const fallback = document.getElementById('fc-fallback');
  const fStatusTitle = document.getElementById('fc-status-title');
  const fStatusDetail = document.getElementById('fc-status-detail');
  const fRetry = document.getElementById('fc-retry');
  const flipBtn = document.getElementById('fc-flip');
  const flashBtn = document.getElementById('fc-flash');
  const timerBtn = document.getElementById('fc-timer');
  const countdownEl = document.getElementById('fc-countdown');
  const recPill = document.getElementById('fc-recpill');
  const recTime = document.getElementById('fc-rec-time');
  const shutter = document.getElementById('fc-shutter');
  const recordBtn = document.getElementById('fc-record');
  const flashFx = document.getElementById('fc-flashfx');
  const shot = document.getElementById('fc-shot');
  const shotPhoto = document.getElementById('fc-shot-photo');
  const shotVideo = document.getElementById('fc-shot-video');
  const retakeBtn = document.getElementById('fc-retake');
  const nextBtn = document.getElementById('fc-next');
  const share = document.getElementById('fc-share');
  const uploadInput = document.getElementById('media-upload-input');
  const previewThumb = document.getElementById('create-preview-thumb');
  const previewVideoEl = document.getElementById('create-preview-video');
  const stagePhoto = document.getElementById('stage-photo');
  const stageVideoEl = document.getElementById('stage-video');

  const S = {
    stream: null,
    facing: 'user',
    torch: false,
    timer: 0,
    counting: false,
    recording: false,
    recorder: null,
    chunks: [],
    recTimer: null,
    recStart: 0,
    shotType: null, // 'photo' | 'video'
    shotSrc: null,
    openTab: 'feed', // the active POST/STORY/REEL tab when the form opened
  };

  const bridge = () => window.__glitchCreate || null;
  const pickMime = () => {
    const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* keep trying */ }
    }
    return '';
  };
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

  const stopStream = () => {
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null;
    if (feed) feed.srcObject = null;
  };

  const applyTransform = () => {
    if (!feed) return;
    feed.style.transform = S.facing === 'user' ? 'scaleX(-1)' : '';
  };

  const showFallback = (title, detail, label) => {
    if (fStatusTitle) fStatusTitle.textContent = title;
    if (fStatusDetail) fStatusDetail.textContent = detail;
    if (fRetry) fRetry.textContent = label;
    if (fallback) fallback.hidden = false;
  };

  const startCamera = async () => {
    stopStream();
    if (S.recTimer) { clearInterval(S.recTimer); S.recTimer = null; }
    S.recording = false;
    if (recPill) recPill.hidden = true;
    if (recordBtn) recordBtn.classList.remove('recording');
    if (shutter) shutter.hidden = false;
    if (flashBtn) flashBtn.hidden = false;
    if (flipBtn) flipBtn.hidden = false;
    if (timerBtn) timerBtn.hidden = false;
    if (countdownEl) countdownEl.hidden = true;
    if (cam) cam.hidden = false;
    if (shot) shot.hidden = true;
    if (share) share.hidden = true;
    if (feed) feed.hidden = false;
    if (shotPhoto) shotPhoto.hidden = true;
    if (shotVideo) shotVideo.hidden = true;
    showFallback('Starting camera…', 'Approve camera access in your browser to see a live preview.', 'Allow camera');
    if (!navigator.mediaDevices?.getUserMedia) {
      showFallback('Camera is not available here', 'Open the preview over HTTPS or localhost, then allow camera access.', 'Try again');
      return;
    }
    const videoC = { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 1920 } };
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: true });
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoC });
      } catch (err2) {
        showFallback('Camera access is off', 'Allow camera access in your browser settings, then tap Enable camera.', 'Enable camera');
        return;
      }
    }
    S.stream = stream;
    feed.srcObject = stream;
    feed.muted = true;
    applyTransform();
    const reveal = () => { if (fallback) fallback.hidden = true; };
    feed.addEventListener('loadedmetadata', reveal, { once: true });
    feed.addEventListener('playing', reveal, { once: true });
    try {
      await feed.play();
      reveal();
    } catch (e) {
      showFallback('Tap to start camera preview', 'Your camera is connected. Tap Enable camera to show the live image.', 'Start preview');
    }
  };

  // ----- capture -----
  const capturePhoto = () => {
    if (!S.stream) { if (fallback) fallback.hidden = false; return; }
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    canvas.getContext('2d').drawImage(feed, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      S.shotType = 'photo';
      S.shotSrc = dataUrl;
      if (flashFx) { flashFx.classList.add('on'); setTimeout(() => flashFx.classList.remove('on'), 200); }
      ingest(blob, 'image/jpeg', 'selfie.jpg');
      showShot();
    }, 'image/jpeg', 0.92);
  };

  const startRecording = () => {
    if (!S.stream) { if (fallback) fallback.hidden = false; return; }
    if (typeof MediaRecorder === 'undefined') { capturePhoto(); return; }
    const mimeType = pickMime();
    try {
      const recorder = new MediaRecorder(S.stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 4e6 });
      S.recorder = recorder;
      S.chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) S.chunks.push(e.data); };
      recorder.onstop = finishRecording;
      recorder.start(250);
      S.recording = true;
      S.recStart = Date.now();
      if (recPill) recPill.hidden = false;
      if (recordBtn) recordBtn.classList.add('recording');
      if (shutter) shutter.hidden = true;
      if (flashBtn) flashBtn.hidden = true;
      if (flipBtn) flipBtn.hidden = true;
      if (timerBtn) timerBtn.hidden = true;
      S.recTimer = setInterval(() => {
        if (recTime) recTime.textContent = fmtTime(Math.floor((Date.now() - S.recStart) / 1000));
      }, 500);
    } catch (err) {
      capturePhoto();
    }
  };

  const finishRecording = () => {
    S.recording = false;
    if (S.recTimer) { clearInterval(S.recTimer); S.recTimer = null; }
    if (recPill) recPill.hidden = true;
    if (recordBtn) recordBtn.classList.remove('recording');
    if (shutter) shutter.hidden = false;
    if (flashBtn) flashBtn.hidden = false;
    if (flipBtn) flipBtn.hidden = false;
    if (timerBtn) timerBtn.hidden = false;
    const type = (S.recorder && S.recorder.mimeType) || 'video/webm';
    const blob = new Blob(S.chunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    S.shotType = 'video';
    S.shotSrc = URL.createObjectURL(blob);
    ingest(blob, type, `clip.${ext}`);
    makePoster(S.shotSrc).then((p) => { if (p) { const b = bridge(); if (b && b.setPoster) b.setPoster(p); } });
    showShot();
  };

  // Draw a poster frame from a video src (used when main.js's stage video is
  // hidden inside the closed stage and can't grab a frame itself).
  const makePoster = (src) => new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 1080;
        c.height = v.videoHeight || 1920;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.8));
      } catch (e) { resolve(''); }
    };
    v.onerror = () => resolve('');
    v.src = src;
  });

  // Feed a captured file into main.js's ingest pipeline, then restore the
  // user's chosen destination tab (the video path force-switches to REEL).
  const ingest = (blob, type, name) => {
    try {
      const file = new File([blob], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      uploadInput.files = dt.files;
      uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (type.startsWith('video/')) {
        setTimeout(() => {
          const b = bridge();
          if (b) {
            b.setVideoMode(true);
            if (S.openTab && S.openTab !== 'videos') b.pickTab(S.openTab);
          }
        }, 0);
      }
    } catch (e) { /* DataTransfer unsupported — publishing falls back to state */ }
  };

  // ----- shot view (retake / next) -----
  const showShot = () => {
    stopStream();
    if (cam) cam.hidden = true;
    if (shot) shot.hidden = false;
    if (S.shotType === 'photo') {
      if (shotPhoto) { shotPhoto.src = S.shotSrc; shotPhoto.hidden = false; }
      if (shotVideo) { shotVideo.hidden = true; shotVideo.removeAttribute('src'); shotVideo.load(); }
    } else {
      if (shotVideo) { shotVideo.src = S.shotSrc; shotVideo.hidden = false; shotVideo.play().catch(() => { /* poster */ }); }
      if (shotPhoto) shotPhoto.hidden = true;
    }
  };

  const openShare = () => {
    if (shot) shot.hidden = true;
    if (share) share.hidden = false;
    const caption = form.querySelector('[name="caption"]');
    if (caption) caption.focus();
  };

  retakeBtn?.addEventListener('click', () => { startCamera(); });
  nextBtn?.addEventListener('click', () => { openShare(); });

  // ----- camera controls -----
  flipBtn?.addEventListener('click', async () => {
    S.facing = S.facing === 'user' ? 'environment' : 'user';
    applyTransform();
    await startCamera();
  });

  flashBtn?.addEventListener('click', async () => {
    const track = S.stream?.getVideoTracks?.()[0];
    try {
      if (track?.applyConstraints) {
        S.torch = !S.torch;
        await track.applyConstraints({ advanced: [{ torch: S.torch }] });
      } else {
        throw new Error('no torch');
      }
    } catch (err) {
      S.torch = false;
    }
    if (flashBtn) flashBtn.classList.toggle('on', S.torch);
  });

  timerBtn?.addEventListener('click', () => {
    S.timer = S.timer === 0 ? 3 : S.timer === 3 ? 5 : 0;
    if (timerBtn) {
      timerBtn.classList.toggle('on', S.timer > 0);
      timerBtn.setAttribute('aria-label', S.timer ? `Timer ${S.timer}s` : 'Timer off');
      timerBtn.textContent = S.timer > 0 ? `⏱${S.timer}` : '⏱';
    }
  });

  fRetry?.addEventListener('click', () => { startCamera(); });

  shutter?.addEventListener('click', () => {
    if (S.recording || S.counting) return;
    if (S.timer > 0) {
      S.counting = true;
      if (countdownEl) countdownEl.hidden = false;
      let n = S.timer;
      if (countdownEl) countdownEl.textContent = String(n);
      const iv = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          clearInterval(iv);
          if (countdownEl) countdownEl.hidden = true;
          S.counting = false;
          capturePhoto();
        } else if (countdownEl) {
          countdownEl.textContent = String(n);
        }
      }, 1000);
    } else {
      capturePhoto();
    }
  });

  recordBtn?.addEventListener('click', () => {
    if (S.recording) {
      if (S.recorder) { try { S.recorder.stop(); } catch (e) { /* ignore */ } }
    } else {
      startRecording();
    }
  });

  // ----- gallery picks while the form is open -----
  // main.js's own change handler ingests the file first (it clears the input),
  // so surface the picked media into the shot view after that handler runs.
  uploadInput?.addEventListener('change', () => {
    setTimeout(() => {
      if (form.hidden) return;
      const sv = (stageVideoEl && (stageVideoEl.currentSrc || stageVideoEl.src)) || '';
      const sp = (stagePhoto && stagePhoto.src) || '';
      if (sv) {
        S.shotType = 'video';
        S.shotSrc = sv;
        showShot();
        makePoster(sv).then((p) => { if (p) { const b = bridge(); if (b && b.setPoster) b.setPoster(p); } });
        setTimeout(() => {
          const b = bridge();
          if (b) {
            b.setVideoMode(true);
            if (S.openTab && S.openTab !== 'videos') b.pickTab(S.openTab);
          }
        }, 0);
      } else if (sp && sp.startsWith('data:')) {
        S.shotType = 'photo';
        S.shotSrc = sp;
        showShot();
      }
    }, 0);
  });

  // ----- form open/close -----
  // main.js populates the hidden #create-preview-thumb / #create-preview-video
  // carriers before showing the form (normal flow: captured on the stage, then
  // Next → edit → Next). If real media is already there, land on the shot view
  // with it; otherwise start the live camera so users can record/take pictures
  // of themselves right here.
  const onFormShow = () => {
    S.openTab = (document.querySelector('.create-tab.active')?.dataset.tab) || 'feed';
    const v = previewVideoEl?.src || '';
    const p = previewThumb?.src || '';
    if (v && v.startsWith('blob:')) {
      S.shotType = 'video';
      S.shotSrc = v;
      showShot();
      return;
    }
    if (p && p.startsWith('data:')) {
      S.shotType = 'photo';
      S.shotSrc = p;
      showShot();
      return;
    }
    startCamera();
  };

  const onFormHide = () => {
    stopStream();
    if (S.recorder && S.recording) { try { S.recorder.stop(); } catch (e) { /* ignore */ } }
    S.recording = false;
    if (S.recTimer) { clearInterval(S.recTimer); S.recTimer = null; }
    if (recPill) recPill.hidden = true;
  };

  const observer = new MutationObserver(() => {
    if (form.hidden) onFormHide();
    else onFormShow();
  });
  observer.observe(form, { attributes: true, attributeFilter: ['hidden'] });
})();
