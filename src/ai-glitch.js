// GlitchIt — AI Glitch generator (camera.html only).
// Turns a text prompt into a generated video using NVIDIA's hosted API
// (build.nvidia.com) via the same-origin /api/nvidia-video proxy, so the API
// key never ships to the browser. Fully self-contained: it injects its own
// launch button + overlay and reuses the app's db.saveMedia pipeline to share
// the finished clip as a story or a reel — no changes to the camera core.
(function () {
  'use strict';

  var API = '/api/nvidia-video';
  var POLL_MS = 4000;
  var MAX_POLLS = 75; // ~5 minutes — long generations time out gracefully
  var MODELS = [
    { id: 'nvidia/veo-3.1', label: 'Veo 3.1', hint: 'Best quality' },
    { id: 'nvidia/kling-2.0', label: 'Kling 2.0', hint: 'Cinematic' },
    { id: 'nvidia/ltx-video', label: 'LTX-Video', hint: 'Fastest' },
  ];

  var btn, overlay, promptEl, modelsEl, genBtn, cancelBtn, statusEl, stageEl, closeBtn;
  var currentModel = MODELS[0].id;
  var polling = false;
  var genId = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    var tip = document.createElement('div');
    tip.className = 'ai-glitch-toast';
    tip.setAttribute('role', 'status');
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function () { tip.remove(); }, 2600);
  }

  function styles() {
    var el = document.createElement('style');
    el.textContent = [
      '.ai-glitch-btn{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:9px 14px;border:0;border-radius:999px;color:#fff;font:800 13px/1 system-ui,-apple-system,sans-serif;cursor:pointer;background:linear-gradient(135deg,#ff2d78,#a24cff 55%,#00d4ff);box-shadow:0 6px 18px rgba(162,76,255,.35)}',
      '.ai-glitch-btn:hover{filter:brightness(1.1)}',
      '.ai-glitch-overlay{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:rgba(8,6,16,.9);backdrop-filter:blur(6px)}',
      '.ai-glitch-card{width:min(480px,100%);max-height:calc(100vh - 36px);overflow-y:auto;padding:22px;border:1px solid #2c2740;border-radius:22px;background:#141321;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.5)}',
      '.ai-glitch-card h2{margin:0 0 4px;font-size:20px;letter-spacing:-.01em}',
      '.ai-glitch-card .sub{margin:0 0 16px;color:#a29bb8;font-size:13px;line-height:1.5}',
      '.ai-glitch-card textarea{width:100%;min-height:92px;resize:vertical;box-sizing:border-box;padding:12px;border:1px solid #38324f;border-radius:14px;background:#0f0d1c;color:#fff;font:14px/1.5 system-ui,-apple-system,sans-serif;outline:none}',
      '.ai-glitch-card textarea:focus{border-color:#a24cff}',
      '.ai-glitch-models{display:flex;gap:8px;margin:12px 0 16px;flex-wrap:wrap}',
      '.ai-glitch-model{padding:7px 12px;border:1px solid #38324f;border-radius:999px;background:transparent;color:#cfc9de;font:700 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer}',
      '.ai-glitch-model small{display:block;margin-top:2px;color:#7d7595;font-weight:600;font-size:10px}',
      '.ai-glitch-model.on{border-color:#a24cff;background:rgba(162,76,255,.14);color:#fff}',
      '.ai-glitch-actions{display:flex;gap:10px;align-items:center}',
      '.ai-glitch-actions button{flex:1;padding:12px;border:0;border-radius:14px;color:#fff;font:800 14px/1 system-ui,-apple-system,sans-serif;cursor:pointer;background:linear-gradient(135deg,#ff2d78,#a24cff 55%,#00d4ff)}',
      '.ai-glitch-actions button:disabled{opacity:.55;cursor:wait}',
      '.ai-glitch-actions button.ghost{flex:0 0 auto;padding:12px 16px;background:#241f38;color:#cfc9de}',
      '.ai-glitch-status{min-height:20px;margin:12px 0 0;color:#8fd8ff;font:600 12.5px/1.5 system-ui,-apple-system,sans-serif}',
      '.ai-glitch-status.err{color:#ff6b8a}',
      '.ai-glitch-stage{display:none;margin-top:14px}',
      '.ai-glitch-stage video{width:100%;max-height:56vh;border-radius:14px;background:#000}',
      '.ai-glitch-share{display:flex;gap:8px;margin-top:10px}',
      '.ai-glitch-share button{flex:1;padding:11px;border:0;border-radius:12px;color:#fff;font:800 13px/1 system-ui,-apple-system,sans-serif;cursor:pointer}',
      '.ai-glitch-share .reel{background:linear-gradient(135deg,#ff2d78,#a24cff)}',
      '.ai-glitch-share .story{background:#2a2350}',
      '.ai-glitch-share .dl{background:#17142a;border:1px solid #38324f;color:#cfc9de}',
      '.ai-glitch-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:1300;padding:10px 18px;border-radius:999px;background:#17142a;border:1px solid #3a3355;color:#fff;font:700 13px/1 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45)}',
      '.ai-glitch-spin{display:inline-block;width:12px;height:12px;margin-right:6px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:aiGlitchSpin .8s linear infinite;vertical-align:-1px}',
      '@keyframes aiGlitchSpin{to{transform:rotate(360deg)}}',
    ].join('\n');
    document.head.appendChild(el);
  }

  function buildUi() {
    styles();
    var host = document.querySelector('.cam-left');
    if (host) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-glitch-btn';
      btn.textContent = '✦ AI Glitch';
      btn.setAttribute('aria-haspopup', 'dialog');
      host.appendChild(btn);
    }

    overlay = document.createElement('div');
    overlay.className = 'ai-glitch-overlay';
    overlay.hidden = true;
    overlay.innerHTML = [
      '<div class="ai-glitch-card" role="dialog" aria-modal="true" aria-labelledby="ai-glitch-title">',
      '<h2 id="ai-glitch-title">✦ AI Glitch</h2>',
      '<p class="sub">Describe a video and NVIDIA generates it for you. A first generation usually takes 1–2 minutes.</p>',
      '<textarea id="ai-glitch-prompt" maxlength="4000" placeholder="e.g. neon football pitch at night, slow-motion bicycle kick, glitch VHS effect, cinematic…"></textarea>',
      '<div class="ai-glitch-models" role="radiogroup" aria-label="Model"></div>',
      '<div class="ai-glitch-actions">',
      '<button type="button" id="ai-glitch-gen">Generate video</button>',
      '<button type="button" class="ghost" id="ai-glitch-cancel" hidden>Stop</button>',
      '<button type="button" class="ghost" id="ai-glitch-close" aria-label="Close">✕</button>',
      '</div>',
      '<div class="ai-glitch-status" id="ai-glitch-status" role="status"></div>',
      '<div class="ai-glitch-stage" id="ai-glitch-stage">',
      '<video id="ai-glitch-video" controls playsinline></video>',
      '<div class="ai-glitch-share">',
      '<button type="button" class="reel" id="ai-glitch-share-reel">Share as reel</button>',
      '<button type="button" class="story" id="ai-glitch-share-story">Share as story</button>',
      '<button type="button" class="dl" id="ai-glitch-download">Download</button>',
      '</div>',
      '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(overlay);

    promptEl = $('ai-glitch-prompt');
    genBtn = $('ai-glitch-gen');
    cancelBtn = $('ai-glitch-cancel');
    closeBtn = $('ai-glitch-close');
    statusEl = $('ai-glitch-status');
    stageEl = $('ai-glitch-stage');
    modelsEl = overlay.querySelector('.ai-glitch-models');

    MODELS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-glitch-model' + (m.id === currentModel ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', m.id === currentModel ? 'true' : 'false');
      b.innerHTML = escapeHtml(m.label) + '<small>' + escapeHtml(m.hint) + '</small>';
      b.addEventListener('click', function () {
        currentModel = m.id;
        modelsEl.querySelectorAll('.ai-glitch-model').forEach(function (x) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        });
      });
      modelsEl.appendChild(b);
    });

    btn && btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', function () { polling = false; });
    genBtn.addEventListener('click', generate);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) close();
    });
    $('ai-glitch-share-reel').addEventListener('click', function () { share('reel'); });
    $('ai-glitch-share-story').addEventListener('click', function () { share('story'); });
    $('ai-glitch-download').addEventListener('click', function () {
      var url = genUrl();
      if (!url) return;
      var a = document.createElement('a');
      a.href = url;
      a.download = 'ai-glitch.mp4';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  function setStatus(msg, isError) {
    statusEl.innerHTML = msg ? escapeHtml(msg) : '';
    statusEl.classList.toggle('err', Boolean(isError));
  }

  function open() {
    overlay.hidden = false;
    stageEl.style.display = 'none';
    setStatus('');
    genBtn.hidden = false;
    cancelBtn.hidden = true;
    setTimeout(function () { promptEl && promptEl.focus(); }, 50);
  }

  function close() {
    polling = false;
    overlay.hidden = true;
  }

  function genUrl() {
    var v = $('ai-glitch-video');
    return v ? v.currentSrc || v.src || '' : '';
  }

  async function generate() {
    var prompt = promptEl.value.trim();
    if (!prompt) { setStatus('Describe the video you want first.', true); return; }
    polling = true;
    genBtn.disabled = true;
    cancelBtn.hidden = false;
    stageEl.style.display = 'none';
    setStatus('Starting generation…');
    try {
      var started = Date.now();
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt, model: currentModel }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        setStatus(data.error || 'Could not start the generation (' + res.status + ').', true);
        polling = false;
        genBtn.disabled = false;
        cancelBtn.hidden = true;
        return;
      }
      genId = data.id;
      setStatus('Generating — this usually takes 1–2 minutes…');
      var tries = 0;
      while (polling && tries < MAX_POLLS) {
        tries += 1;
        await new Promise(function (r) { setTimeout(r, POLL_MS); });
        if (!polling) break;
        var elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
        setStatus('Generating… ' + elapsed + 's elapsed');
        var poll = await fetch(API + '?id=' + encodeURIComponent(genId));
        var state = await poll.json().catch(function () { return {}; });
        if (state.status === 'completed' && state.videoUrl) {
          showResult(state.videoUrl);
          return;
        }
        if (state.status === 'failed') {
          setStatus(state.error || 'The generation failed — try a different prompt.', true);
          break;
        }
      }
      if (polling && tries >= MAX_POLLS) setStatus('Still rendering on NVIDIA’s side — close and tap Generate again to resume later.', true);
    } catch (err) {
      setStatus('Could not reach the generator — check your connection.', true);
    } finally {
      polling = false;
      genBtn.disabled = false;
      cancelBtn.hidden = true;
    }
  }

  function showResult(url) {
    setStatus('Done — your AI Glitch is ready ✦');
    var v = $('ai-glitch-video');
    v.src = url;
    stageEl.style.display = 'block';
    try { v.play().catch(function () { /* autoplay may be blocked — controls are on */ }); } catch (err) { /* ignore */ }
  }

  // Share the generated clip through the same db.saveMedia pipeline the
  // camera uses for recorded content (story shelf / reels feed).
  async function share(kind) {
    var url = genUrl();
    if (!url) return;
    var user = window.GLITCHIT_USER;
    if (!user || user.guest) {
      toast('Sign in to share your ' + kind);
      setTimeout(function () { location.href = 'auth.html?returnTo=camera.html'; }, 1300);
      return;
    }
    try {
      var db = await import('./db.js?v=7');
      if (!db || typeof db.saveMedia !== 'function') throw new Error('no-db');
      toast(kind === 'reel' ? 'Uploading your AI reel…' : 'Uploading your AI story…');
      var file = await (await fetch(url)).blob();
      var handle = (user.user_metadata && user.user_metadata.username) || (user.email || '').split('@')[0] || '';
      var avatar = '';
      try { avatar = localStorage.getItem('glitchit.avatar.v1') || ''; } catch (e) { /* ignore */ }
      if (!avatar) avatar = (user.user_metadata && user.user_metadata.avatar) || '';
      var prompt = (promptEl.value || '').trim().slice(0, 90);
      var res = await db.saveMedia({
        type: 'video',
        kind: kind === 'story' ? 'story' : 'video',
        file: file,
        title: kind === 'reel' ? 'Reel' : 'Story',
        caption: 'AI Glitch ✦ ' + (prompt || 'generated with NVIDIA'),
        handle: handle,
        avatar: avatar,
        verified: false,
      });
      if (!res.ok) throw new Error(res.reason || 'save');
      if (kind === 'story') {
        var record = { url: res.url, poster: res.url, kind: 'video', at: Date.now(), reveal: false, closeFriends: false };
        try {
          localStorage.setItem('glitchit.story.latest', JSON.stringify(record));
          var mine = [];
          try { mine = JSON.parse(localStorage.getItem('glitchit.story.mine') || '[]'); } catch (e) { mine = []; }
          if (!Array.isArray(mine)) mine = [];
          mine.unshift(record);
          localStorage.setItem('glitchit.story.mine', JSON.stringify(mine.slice(0, 12)));
        } catch (e) { /* storage unavailable */ }
      }
      toast(kind === 'reel' ? 'Reel shared ✦' : 'Story shared ✦');
      setTimeout(function () { location.href = kind === 'reel' ? 'glitches.html' : 'index.html'; }, 900);
    } catch (err) {
      toast('Couldn’t share — ' + (err && err.message ? err.message : 'try again'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUi);
  } else {
    buildUi();
  }
})();
