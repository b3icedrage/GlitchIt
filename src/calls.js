// GlitchIt — in-app audio & video calls (src/calls.js).
// Loaded on chat.html after main.js + social-wire.js. Exposes
// window.GLITCHIT_CALLS:
//   startCall(opts)   — open the call overlay and dial into a LiveKit room
//                       { mode: 'audio'|'video', kind: 'direct'|'group',
//                         target: { id, name, avatar }, groupName?, members? }
//   joinTestRoom(room) — join a room from a second window
//                       (chat.html?test-call=<room>) for real two-way calls.
//
// Media flows through LiveKit Cloud (WebRTC SFU): this window publishes its
// mic/camera to the room and renders whoever else joins the same room. When
// LiveKit isn't configured (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
// missing), startCall falls back to the old built-in demo flow so the call
// UI still works — the other side is just simulated until LiveKit is set up.
(function () {
  'use strict';

  let active = null;       // the main call overlay state (one at a time)
  let activeTest = null;   // the test-window overlay state

  const ICONS = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    end: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };

  function fmt(totalSeconds) {
    const s = Math.max(0, totalSeconds | 0);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // Deterministic, URL-safe room name per conversation — both callers derive
  // the same room from the same partner/group key without any shared state.
  function roomNameFor(kind, id) {
    const s = String(id || (kind === 'group' ? 'group' : 'direct'));
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) | 0;
      h2 = ((h2 << 5) + h2 + c) | 0;
    }
    return `glitchit-${kind}-${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
  }

  function myIdentity() {
    const me = window.GLITCHIT_USER;
    if (me && !me.guest && me.id) return String(me.id);
    return `guest-${Math.random().toString(36).slice(2, 8)}`;
  }

  function myName() {
    const me = window.GLITCHIT_USER;
    return (me && !me.guest && (me.user_metadata?.username || me.email?.split('@')[0]))
      || ((typeof profile !== 'undefined' && profile.username) || 'you');
  }

  function myAvatar() {
    return (typeof profile !== 'undefined' && profile.avatar) || fallbackAvatar(myName());
  }

  async function fetchToken(room, identity) {
    try {
      const res = await fetch(`/api/livekit-token?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.ok !== true || !data.token || !data.url) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  // Every tile carries a video element; it stays transparent until a track is
  // attached, so the avatar underneath shows through until then.
  function tileHtml(p) {
    const avatar = p.avatar
      ? `<img src="${escapeHtml(p.avatar)}" alt="">`
      : `<span class="call-tile-initial">${escapeHtml(String(p.name || '?')[0].toUpperCase())}</span>`;
    return `
      <div class="call-tile ${p.me ? 'me' : 'remote'}${p.pip ? ' pip' : ''}${p.noCam ? ' cam-off' : ''}${p.audioOnly ? ' audio-only' : ''}" data-id="${escapeHtml(p.id || '')}">
        <video class="call-video" autoplay playsinline ${p.me ? 'muted' : ''}></video>
        <div class="call-tile-fallback">${avatar}</div>
        <span class="call-tile-name">${escapeHtml(p.name || 'Member')}</span>
        ${p.me ? '' : '<i class="call-live" aria-hidden="true"></i>'}
      </div>`;
  }

  function setStatus(state, text, cls) {
    if (!state.statusEl) return;
    state.statusEl.textContent = text;
    state.statusEl.className = `call-status${cls ? ` ${cls}` : ''}`;
  }

  function startTimer(state) {
    if (state.timerId) return;
    state.startedAt = Date.now();
    state.timerEl.hidden = false;
    state.timerId = window.setInterval(() => {
      state.timerEl.textContent = fmt(Math.round((Date.now() - state.startedAt) / 1000));
    }, 1000);
  }

  function startRinging(state) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.gain.value = 0.06;
      gain.connect(ctx.destination);
      const beep = () => {
        const first = ctx.createOscillator();
        first.type = 'sine';
        first.frequency.value = 620;
        first.connect(gain);
        first.start();
        first.stop(ctx.currentTime + 0.45);
        const second = ctx.createOscillator();
        second.type = 'sine';
        second.frequency.value = 470;
        second.connect(gain);
        second.start(ctx.currentTime + 0.5);
        second.stop(ctx.currentTime + 0.95);
      };
      beep();
      state.ringTimer = window.setInterval(beep, 1700);
      state.ringCtx = ctx;
    } catch (err) { /* no audio — call stays visual */ }
  }

  function stopRinging(state) {
    if (state.ringTimer) { clearInterval(state.ringTimer); state.ringTimer = null; }
    if (state.ringCtx) { try { state.ringCtx.close(); } catch (err) { /* ignore */ } state.ringCtx = null; }
  }

  function goLive(state) {
    if (state.ended || state.phase === 'active') return;
    state.phase = 'active';
    state.wrap.dataset.phase = 'active';
    state.wrap.classList.add('active');
    setStatus(state, 'Live', 'live');
    startTimer(state);
    state.tiles.forEach((t) => t.classList.add('live'));
    stopRinging(state);
  }

  function updateStatus(state) {
    if (!state.livekit || state.ended || state.phase !== 'active') return;
    if (state.remoteCount === 0) {
      setStatus(state, state.isGroup ? 'Waiting for members to join…' : 'Waiting for them to join…', 'waiting');
    } else {
      setStatus(state, 'Live', 'live');
    }
  }

  // Find the tile that belongs to a LiveKit participant. Group calls match by
  // the identity baked into the token; unknown participants get a new tile.
  function tileForParticipant(state, participant) {
    let meta = null;
    try { meta = participant.metadata ? JSON.parse(participant.metadata) : null; } catch (err) { /* ignore */ }
    const id = String((meta && meta.id) || participant.identity || '');
    const tiles = state.wrap.querySelectorAll('.call-tile');
    for (const tile of tiles) {
      if (tile.dataset.id === id) return tile;
    }
    if (state.isGroup && state.tilesWrap) {
      const tile = document.createElement('div');
      tile.className = 'call-tile remote';
      tile.dataset.id = id;
      const nm = (meta && meta.name) || participant.name || 'Member';
      tile.innerHTML = `<video class="call-video" autoplay playsinline></video>
        <div class="call-tile-fallback"><span class="call-tile-initial">${escapeHtml(String(nm)[0].toUpperCase())}</span></div>
        <span class="call-tile-name">${escapeHtml(nm)}</span>
        <i class="call-live" aria-hidden="true"></i>`;
      state.tilesWrap.appendChild(tile);
      state.tiles = state.wrap.querySelectorAll('.call-tile');
      return tile;
    }
    // 1:1 — the other side maps to the main remote tile.
    return state.wrap.querySelector('.call-tile.remote:not(.me)');
  }

  // ---------- Real flow: LiveKit Cloud ----------
  async function runLiveKitFlow(state, info) {
    const LK = window.LivekitClient;
    let room;
    try {
      room = new LK.Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: { width: 640, height: 480 } },
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true },
      });
      state.room = room;
      await room.connect(info.url, info.token, {
        autoSubscribe: true,
        metadata: JSON.stringify({ id: state.identity, name: state.meName, avatar: state.meAvatar }),
      });
    } catch (err) {
      console.warn('GlitchIt: LiveKit connect failed — running demo mode', err);
      if (state.ended) return;
      state.livekit = false;
      runLegacyFlow(state);
      return;
    }
    state.livekit = true;
    const lp = room.localParticipant;

    room.on('trackSubscribed', (track, publication, participant) => {
      const tile = tileForParticipant(state, participant);
      if (!tile) return;
      const video = tile.querySelector('video');
      if (!video) return;
      try { track.attach(video); } catch (err) { /* ignore */ }
      state.attachedVideos.add(video);
      if (state.speaker === false) video.muted = true;
      if (participant.isLocal) {
        if (track.kind === 'video') tile.classList.remove('cam-off');
      } else {
        tile.classList.add('live');
        state.remoteCount += 1;
        if (state.phase !== 'active') goLive(state);
        updateStatus(state);
      }
    });

    room.on('trackUnsubscribed', (track) => {
      try { track.detach(); } catch (err) { /* ignore */ }
    });

    room.on('participantDisconnected', (participant) => {
      const tile = tileForParticipant(state, participant);
      if (tile) {
        tile.classList.remove('live');
        const video = tile.querySelector('video');
        if (video) {
          try { video.srcObject = null; } catch (err) { /* ignore */ }
          state.attachedVideos.delete(video);
        }
      }
      state.remoteCount = Math.max(0, state.remoteCount - 1);
      updateStatus(state);
    });

    room.on('disconnected', () => { /* endCall handles cleanup */ });

    // Publish my mic (and camera for video calls) through LiveKit — it runs
    // getUserMedia itself and fires trackSubscribed for the local track.
    try {
      await lp.setMicrophoneEnabled(true);
      if (state.mode === 'video') await lp.setCameraEnabled(true);
    } catch (err) { /* camera/mic denied — avatar fallback stays */ }

    goLive(state);
    updateStatus(state);
  }

  // ---------- Fallback flow: built-in demo (no LiveKit configured) ----------
  function runLegacyFlow(state) {
    state.wrap.dataset.phase = 'connecting';
    setStatus(state, 'Connecting…', 'connecting');
    state.timers.push(window.setTimeout(() => {
      goLive(state);
      // Local preview straight from getUserMedia; remote side is simulated.
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        const wantsVideo = state.mode === 'video' && !state.camOff;
        navigator.mediaDevices.getUserMedia(wantsVideo
          ? { video: { facingMode: 'user', width: { ideal: 640 } }, audio: true }
          : { audio: true })
          .then((stream) => {
            state.stream = stream;
            const video = state.wrap.querySelector('.call-tile.me video');
            if (video) {
              video.srcObject = stream;
              video.hidden = state.camOff;
              video.play().catch(() => {});
            }
          })
          .catch(() => { /* camera/mic denied — tiles fall back to the avatar */ });
      }
    }, 900 + Math.random() * 600));
  }

  function endCall(state) {
    if (state.ended) return;
    state.ended = true;
    stopRinging(state);
    state.timers.forEach((id) => clearTimeout(id));
    if (state.timerId) clearInterval(state.timerId);
    if (state.room) {
      try { state.room.disconnect(); } catch (err) { /* ignore */ }
      state.room = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    const dur = state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
    state.wrap.classList.add('ended');
    const ctlRow = state.wrap.querySelector('.call-controls');
    const note = state.wrap.querySelector('.call-note');
    const testBtn = state.wrap.querySelector('.call-test-btn');
    if (ctlRow) ctlRow.hidden = true;
    if (note) note.hidden = true;
    if (testBtn) testBtn.hidden = true;
    state.timerEl.hidden = true;
    setStatus(state, dur ? `Call ended · ${fmt(dur)}` : 'Call ended', 'ended');
    window.setTimeout(() => { state.wrap.remove(); active = null; }, 2200);
  }

  function startCall(opts) {
    if (active) return active;
    const o = opts || {};
    const mode = o.mode === 'video' ? 'video' : 'audio';
    const isGroup = o.kind === 'group';
    const target = o.target || { id: '', name: 'Creator', avatar: '' };
    const members = Array.isArray(o.members) ? o.members : [];
    const identity = myIdentity();
    const meName = myName();
    const meAvatar = myAvatar();
    const roomName = roomNameFor(isGroup ? 'group' : 'direct', isGroup ? (o.groupId || o.groupName || 'group') : (target.id || 'direct'));

    let tilesHtml;
    if (isGroup) {
      const people = members.map((m) => ({ id: m.id, name: m.name || m.username || m.handle || 'Member', avatar: m.avatar || '', me: false }));
      people.push({ id: identity, name: meName, avatar: meAvatar, me: true, noCam: mode === 'video', audioOnly: mode === 'audio' });
      tilesHtml = people.map((p) => tileHtml(p)).join('');
    } else {
      tilesHtml = tileHtml({ id: target.id, name: target.name, avatar: target.avatar })
        + tileHtml({ id: identity, name: meName, avatar: meAvatar, me: true, pip: true, noCam: mode === 'video', audioOnly: mode === 'audio' });
    }

    const wrap = document.createElement('div');
    wrap.className = 'call-overlay';
    wrap.dataset.kind = isGroup ? 'group' : 'direct';
    wrap.dataset.phase = 'ringing';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', `${mode === 'video' ? 'Video' : 'Audio'} call`);
    wrap.innerHTML = `
      <div class="call-backdrop"></div>
      <div class="call-stage">
        <div class="call-head">
          <span class="call-status">Ringing…</span>
          <span class="call-timer" hidden>00:00</span>
        </div>
        <div class="call-tiles">${tilesHtml}</div>
        <div class="call-controls">
          <button type="button" class="call-ctl" data-ctl="mute" aria-label="Mute microphone" aria-pressed="false">${ICONS.mic}</button>
          ${mode === 'video' ? `<button type="button" class="call-ctl" data-ctl="camera" aria-label="Turn camera off" aria-pressed="false">${ICONS.cam}</button>` : ''}
          <button type="button" class="call-ctl" data-ctl="speaker" aria-label="Speaker on" aria-pressed="false">${ICONS.speaker}</button>
          <button type="button" class="call-ctl end" data-ctl="end" aria-label="End call">${ICONS.end}</button>
        </div>
        <div class="call-note">${isGroup
          ? `${members.length + 1} people · ${mode === 'video' ? 'Video' : 'Audio'} group call`
          : `${mode === 'video' ? 'Video' : 'Audio'} call with ${escapeHtml(target.name)}`}</div>
        <button type="button" class="call-test-btn" hidden>${ICONS.plus}<span>Test with another window</span></button>
      </div>`;
    document.body.appendChild(wrap);

    const state = {
      wrap,
      tilesWrap: wrap.querySelector('.call-tiles'),
      tiles: wrap.querySelectorAll('.call-tile'),
      statusEl: wrap.querySelector('.call-status'),
      timerEl: wrap.querySelector('.call-timer'),
      mode,
      isGroup,
      roomName,
      identity,
      meName,
      meAvatar,
      phase: 'ringing',
      muted: false,
      camOff: false,
      speaker: true,
      ended: false,
      livekit: false,
      remoteCount: 0,
      startedAt: 0,
      timerId: null,
      ringTimer: null,
      ringCtx: null,
      stream: null,
      room: null,
      timers: [],
      attachedVideos: new Set(),
    };

    // Start the ring immediately, then connect to LiveKit in the background.
    startRinging(state);

    wrap.querySelectorAll('.call-ctl').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ctl = btn.dataset.ctl;
        if (ctl === 'end') { endCall(state); return; }
        const lp = state.room && state.room.localParticipant;
        if (ctl === 'mute') {
          state.muted = !state.muted;
          btn.classList.toggle('off', state.muted);
          btn.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
          btn.setAttribute('aria-label', state.muted ? 'Unmute microphone' : 'Mute microphone');
          if (lp) lp.setMicrophoneEnabled(!state.muted).catch(() => {});
          else if (state.stream) state.stream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
        } else if (ctl === 'camera') {
          state.camOff = !state.camOff;
          btn.classList.toggle('off', state.camOff);
          btn.setAttribute('aria-pressed', state.camOff ? 'true' : 'false');
          btn.setAttribute('aria-label', state.camOff ? 'Turn camera on' : 'Turn camera off');
          if (lp) lp.setCameraEnabled(!state.camOff).catch(() => {});
          else if (state.stream) state.stream.getVideoTracks().forEach((t) => { t.enabled = !state.camOff; });
          const myTile = state.wrap.querySelector('.call-tile.me');
          if (myTile) myTile.classList.toggle('cam-off', state.camOff);
          const video = state.wrap.querySelector('.call-tile.me video');
          if (video) video.hidden = state.camOff;
        } else if (ctl === 'speaker') {
          state.speaker = !state.speaker;
          btn.classList.toggle('off', !state.speaker);
          btn.setAttribute('aria-pressed', state.speaker ? 'true' : 'false');
          btn.setAttribute('aria-label', state.speaker ? 'Speaker on' : 'Speaker off');
          state.attachedVideos.forEach((v) => { v.muted = !state.speaker; });
        }
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.wrap.isConnected) endCall(state);
    }, { once: true });

    const testBtn = wrap.querySelector('.call-test-btn');
    testBtn.addEventListener('click', () => {
      window.open(`chat.html?test-call=${encodeURIComponent(state.roomName)}`, '_blank', 'noopener');
    });

    // Outbound flow: connect to LiveKit (real) or fall back to the demo.
    fetchToken(state.roomName, state.identity).then((info) => {
      if (state.ended) return;
      if (info && window.LivekitClient && state.roomName) {
        testBtn.hidden = false;
        runLiveKitFlow(state, info);
      } else {
        runLegacyFlow(state);
      }
    });

    active = state;
    return state;
  }

  // ---------- Second-window test participant (chat.html?test-call=<room>) ----------
  function showTestNotice(message) {
    const el = document.createElement('div');
    el.className = 'call-unconfigured';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
  }

  async function joinTestRoom(roomName) {
    if (activeTest || active) return;
    const LK = window.LivekitClient;
    const identity = `test-${Math.random().toString(36).slice(2, 8)}`;
    const info = await fetchToken(roomName, identity);
    if (!LK || !info) {
      showTestNotice('LiveKit isn’t configured yet — add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET, then reload to try live test calls.');
      return;
    }

    const room = new LK.Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: { width: 640, height: 480 } },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true },
    });
    try {
      await room.connect(info.url, info.token, {
        autoSubscribe: true,
        metadata: JSON.stringify({ id: identity, name: 'Test window', avatar: '' }),
      });
    } catch (err) {
      showTestNotice('Could not join the test room — check your LiveKit project settings.');
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'call-overlay test-call';
    wrap.dataset.kind = 'direct';
    wrap.dataset.phase = 'active';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Test call participant');
    wrap.innerHTML = `
      <div class="call-backdrop"></div>
      <div class="call-stage">
        <div class="call-head"><span class="call-status live">Test participant</span><span class="call-timer">00:00</span></div>
        <div class="call-tiles">
          <div class="call-tile remote" id="test-remote"><video class="call-video" autoplay playsinline></video><div class="call-tile-fallback"><span class="call-tile-initial">R</span></div><span class="call-tile-name">Other window</span><i class="call-live" aria-hidden="true"></i></div>
          <div class="call-tile me pip cam-off" id="test-local"><video class="call-video" autoplay playsinline muted></video><div class="call-tile-fallback"><span class="call-tile-initial">Y</span></div><span class="call-tile-name">You</span></div>
        </div>
        <div class="call-controls">
          <button type="button" class="call-ctl end" data-test-end aria-label="Leave test call">${ICONS.end}</button>
        </div>
        <div class="call-note">This window joined the call room — the other window should now show you live.</div>
      </div>`;
    document.body.appendChild(wrap);

    const startedAt = Date.now();
    const timerEl = wrap.querySelector('.call-timer');
    const timerId = window.setInterval(() => {
      timerEl.textContent = fmt(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    const localVideo = wrap.querySelector('#test-local video');
    const remoteVideo = wrap.querySelector('#test-remote video');
    const localTile = wrap.querySelector('#test-local');
    const remoteTile = wrap.querySelector('#test-remote');

    room.on('trackSubscribed', (track, publication, participant) => {
      if (participant.isLocal) {
        if (track.kind === 'video') localTile.classList.remove('cam-off');
        try { track.attach(localVideo); } catch (err) { /* ignore */ }
      } else {
        try { track.attach(remoteVideo); } catch (err) { /* ignore */ }
        remoteTile.classList.add('live');
      }
    });

    room.on('disconnected', () => {
      clearInterval(timerId);
      wrap.remove();
      activeTest = null;
    });

    wrap.querySelector('[data-test-end]').addEventListener('click', () => {
      try { room.disconnect(); } catch (err) { /* ignore */ }
    });

    activeTest = { wrap, room, timerId };
  }

  // chat.html?test-call=<room> opens this window as a second participant so
  // real two-way audio/video can be verified (same room, two windows).
  (function boot() {
    const params = new URLSearchParams(location.search);
    const room = params.get('test-call');
    if (room) joinTestRoom(room);
  })();

  window.GLITCHIT_CALLS = { startCall, joinTestRoom };
})();
