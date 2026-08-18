/* GlitchIt — Notes music UI (Spotify-style music sheet + Instagram-style composer)
   Loaded AFTER src/main.js on pages that can open the note composer
   (messages, profile, home). Overrides the global renderTrackRows /
   renderMusicLibrary / searchWeb functions from main.js and upgrades the
   note composer into an Instagram Notes-style editor:

   - Speech-bubble "Note..." input with a gradient-ring avatar + music button
   - ♪ / 📍 / GIF action row
   - A "New song" bottom sheet with album art, title/artist, a 30s clip chip,
     playback timeline and an audio waveform with a selection highlight
   - Bookmarkable song rows in the music sheet (For you / Trending / Saved)

   Search + trending data comes from the same-origin /api/music proxy
   (server.js locally, api/music.js on Vercel) because the Deezer and
   Apple Music APIs don't send CORS headers to browsers. */

/* ---------- saved tracks (localStorage) ---------- */
const MUSIC_SAVED_KEY = 'glitchit.music.saved.v1';
const MUSIC_BANNER_KEY = 'glitchit.music.spotify.dismissed.v1';

function musicLoadSaved() {
  try {
    const arr = JSON.parse(localStorage.getItem(MUSIC_SAVED_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
const musicSaved = musicLoadSaved();

function musicPersistSaved() {
  try { localStorage.setItem(MUSIC_SAVED_KEY, JSON.stringify(musicSaved)); } catch (e) { /* ignore */ }
}
function musicIsSaved(url) {
  return musicSaved.some((t) => t.url === url);
}

/* ---------- shared state ---------- */
let musicTab = 'foryou';        // foryou | trending | saved
let musicTrendingCache = null;  // array of trending tracks once loaded
let musicSearchTimer = null;

function musicShowToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'music-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

function musicOpenLibrary() {
  renderMusicLibrary();
  const lib = document.getElementById('music-library');
  if (lib) lib.hidden = false;
}

/* ---------- tab switching ---------- */
function musicSetTab(name, silent) {
  musicTab = name;
  document.querySelectorAll('[data-music-tab]').forEach((tab) => {
    const on = tab.dataset.musicTab === name;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (silent) return;
  const list = document.getElementById('music-list');
  const input = document.getElementById('music-search');
  if (!list) return;
  if (name === 'saved') {
    musicRenderSaved(list);
  } else if (name === 'trending') {
    musicLoadTrending(list);
  } else {
    // For you — reflect whatever is in the search box
    renderMusicLibrary();
  }
  if (input && name !== 'foryou') input.blur();
}

/* ---------- tabs: Saved ---------- */
function musicRenderSaved(list) {
  if (!musicSaved.length) {
    renderTrackRows([], list, 'Nothing saved yet — tap the bookmark on any song to keep it here.');
    return;
  }
  musicSaved.forEach((t) => { if (t.url) noteState.trackCache[t.url] = t; });
  renderTrackRows(musicSaved, list, 'Nothing saved yet.');
}

/* ---------- tabs: Trending (global chart via the /api/music proxy) ---------- */
function musicLoadTrending(list) {
  if (musicTrendingCache) {
    renderTrackRows(musicTrendingCache, list, 'No trending tracks right now.');
    return;
  }
  list.innerHTML = '<p class="music-empty">Loading trending songs…</p>';
  fetch((window.GLITCHIT_API_BASE || '') + '/api/music?chart=1')
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.ok || !Array.isArray(data.tracks) || !data.tracks.length) throw new Error('empty');
      musicTrendingCache = data.tracks;
      data.tracks.forEach((t) => { if (t.url) noteState.trackCache[t.url] = t; });
      renderTrackRows(data.tracks, list, 'No trending tracks right now.');
    })
    .catch(() => {
      list.innerHTML = '<p class="music-empty">Trending songs are unavailable right now — try again in a moment.</p>';
    });
}

/* ---------- override: web search through the same-origin proxy ---------- */
function searchWeb(q, list) {
  list.innerHTML = '<p class="music-empty">Searching the web…</p>';
  fetch((window.GLITCHIT_API_BASE || '') + '/api/music?q=' + encodeURIComponent(q))
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.ok || !Array.isArray(data.tracks)) throw new Error('bad');
      data.tracks.forEach((t) => { if (t.url) noteState.trackCache[t.url] = t; });
      renderTrackRows(data.tracks, list, 'No web results for that search.');
    })
    .catch(() => {
      list.innerHTML = '<p class="music-empty">Music search is unavailable right now — please try again.</p>';
    });
}

/* ---------- override: song row rendering (artwork + play overlay + save) ---------- */
function renderTrackRows(tracks, list, emptyMsg) {
  list.innerHTML = tracks.length
    ? tracks.map((t) => {
        const id = t.url;
        const thumb = t.art || '';
        const explicit = t.explicit ? '<span class="music-explicit">E</span>' : '';
        const dur = (typeof t.duration === 'number' && t.duration > 0) ? ` • ${fmtTime(t.duration)}` : '';
        const saved = musicIsSaved(id) ? ' saved' : '';
        return `<div class="music-row" role="button" tabindex="0" data-id="${escapeHtml(id)}">
          <span class="music-thumb${thumb ? '' : ' fallback'}">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '♪'}</span>
          <button type="button" class="music-play" data-note-play data-id="${escapeHtml(id)}" aria-label="Preview">▶</button>
          <span class="music-meta"><b>${escapeHtml(t.title)}${explicit}</b><em>${escapeHtml(t.artist)}${dur}</em></span>
          <button type="button" class="music-save${saved}" data-save="${escapeHtml(id)}" aria-label="Save track" aria-pressed="${saved ? 'true' : 'false'}"><svg viewBox="0 0 24 24" width="18" height="18" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
        </div>`;
      }).join('')
    : `<p class="music-empty">${escapeHtml(emptyMsg || 'No tracks found.')}</p>`;

  list.querySelectorAll('.music-row').forEach((row) => {
    const id = row.dataset.id;
    const track = findTrack(id);
    if (track && track.url) noteState.trackCache[id] = track;
    const playBtn = row.querySelector('.music-play');
    const saveBtn = row.querySelector('.music-save');

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = findTrack(id);
      if (t) notePlay(t, e.currentTarget);
    });

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = findTrack(id);
      if (!t) return;
      const savedIdx = musicSaved.findIndex((s) => s.url === t.url);
      if (savedIdx === -1) {
        musicSaved.unshift(Object.assign({}, t, { savedAt: Date.now() }));
        musicPersistSaved();
        musicShowToast('Saved to your music');
        row.classList.add('saved');
        saveBtn.classList.add('saved');
        saveBtn.setAttribute('aria-pressed', 'true');
        saveBtn.querySelector('svg').setAttribute('fill', 'currentColor');
      } else {
        musicSaved.splice(savedIdx, 1);
        musicPersistSaved();
        musicShowToast('Removed from saved');
        row.classList.remove('saved');
        saveBtn.classList.remove('saved');
        saveBtn.setAttribute('aria-pressed', 'false');
        saveBtn.querySelector('svg').setAttribute('fill', 'none');
        if (musicTab === 'saved') {
          const list = document.getElementById('music-list');
          if (list) musicRenderSaved(list);
        }
      }
    });

    const select = () => {
      const t = findTrack(id);
      if (!t) return;
      const m = Object.assign({}, t);
      if (typeof m.full !== 'number' || !(m.full > 0)) {
        // Fresh track: `duration` is the full length, so default to a 30s clip.
        m.full = (typeof t.duration === 'number' && t.duration > 0) ? t.duration : 0;
        m.start = 0;
        m.duration = (m.full > 0 && m.full <= 30) ? m.full : 30;
      } else {
        // Already carries clip info (e.g. re-selecting a saved track).
        if (typeof m.start !== 'number') m.start = 0;
        if (typeof m.duration !== 'number' || !(m.duration > 0)) {
          m.duration = (m.full > 0 && m.full <= 30) ? m.full : 30;
        }
      }
      noteState.composerMusic = m;
      document.getElementById('music-library').hidden = true;
      noteStop();
      musicRefreshComposerSheet();
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
    });
  });
}

/* ---------- override: library entry point (tab-aware) ---------- */
function renderMusicLibrary() {
  const input = document.getElementById('music-search');
  const list = document.getElementById('music-list');
  if (!input || !list) return;
  const q = (input.value || '').trim();
  if (q) {
    // Typing always returns to the "For you" search tab.
    musicSetTab('foryou', true);
    clearTimeout(musicSearchTimer);
    musicSearchTimer = setTimeout(() => searchWeb(q, list), 350);
    return;
  }
  if (musicTab === 'saved') { musicRenderSaved(list); return; }
  if (musicTab === 'trending') { musicLoadTrending(list); return; }
  // "For you" with no query: show the trending chart so the sheet opens alive.
  musicLoadTrending(list);
}

/* ---------- UI upgrade: swap the library card for the new design ---------- */
function musicUpgradeLibrary() {
  const library = document.getElementById('music-library');
  if (!library || library.dataset.musicUpgraded) return;
  const card = library.querySelector('.note-modal-card');
  if (!card) return;
  library.dataset.musicUpgraded = '1';
  card.className = 'note-modal-card note-music-card';
  card.innerHTML = `<button type="button" class="note-modal-close" data-close aria-label="Close">×</button>
    <div class="music-search-wrap">
      <svg class="music-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
      <input class="music-search" id="music-search" placeholder="Search..." autocomplete="off" spellcheck="false" aria-label="Search songs">
      <button type="button" class="music-search-clear" id="music-search-clear" aria-label="Clear search" hidden>✕</button>
    </div>
    <div class="music-tabs" role="tablist" aria-label="Music categories">
      <button type="button" class="music-tab active" data-music-tab="foryou" role="tab" aria-selected="true">For you</button>
      <button type="button" class="music-tab" data-music-tab="trending" role="tab" aria-selected="false">Trending</button>
      <button type="button" class="music-tab" data-music-tab="saved" role="tab" aria-selected="false">Saved</button>
    </div>
    <div class="music-spotify" id="music-spotify">
      <span class="music-spotify-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
      </span>
      <span class="music-spotify-copy">
        <strong>Link Spotify</strong>
        <em>Link your account to share the music you're listening to. <b>How it works</b></em>
      </span>
      <button type="button" class="music-spotify-close" id="music-spotify-close" aria-label="Dismiss">×</button>
    </div>
    <div class="music-list" id="music-list"></div>`;

  const input = document.getElementById('music-search');
  const list = document.getElementById('music-list');
  const clearBtn = document.getElementById('music-search-clear');

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    renderMusicLibrary();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    renderMusicLibrary();
    input.focus();
  });

  document.querySelectorAll('[data-music-tab]').forEach((tab) => {
    tab.addEventListener('click', () => musicSetTab(tab.dataset.musicTab));
  });

  const banner = document.getElementById('music-spotify');
  if (banner) {
    try { if (localStorage.getItem(MUSIC_BANNER_KEY)) banner.hidden = true; } catch (e) { /* ignore */ }
    const close = document.getElementById('music-spotify-close');
    if (close) {
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        banner.hidden = true;
        try { localStorage.setItem(MUSIC_BANNER_KEY, '1'); } catch (err) { /* ignore */ }
      });
    }
    banner.addEventListener('click', () => musicShowToast('Spotify linking is coming soon — stay tuned.'));
  }
}

/* ================= Instagram-style note composer ================= */

/* ---------- waveform helpers (deterministic per track) ---------- */
function musicWaveformBars(url) {
  const s = String(url || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bars = [];
  for (let i = 0; i < 44; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    bars.push(22 + (h % 780) / 10); // 22% .. 99% of the wave height
  }
  return bars;
}

function musicFullLen(m) {
  if (m.full && m.full > 0) return m.full;
  if (m.duration && m.duration > 0) return m.duration;
  return 30;
}

function musicRenderWaveform(waveEl, m) {
  if (!waveEl) return;
  const bars = musicWaveformBars(m.url);
  const full = musicFullLen(m);
  const clipOn = m.duration > 0;
  const selStart = clipOn ? Math.max(0, m.start || 0) : 0;
  const selEnd = clipOn ? Math.min(full, (m.start || 0) + m.duration) : full;
  const left = Math.min(100, Math.max(0, (selStart / full) * 100));
  const width = Math.max(0, Math.min(100 - left, ((selEnd - selStart) / full) * 100));
  waveEl.innerHTML = `<span class="nc-wave-bars">${bars.map((v) => `<i style="height:${v.toFixed(1)}%"></i>`).join('')}</span>` +
    `<span class="nc-wave-sel" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>`;
}

/* ---------- sheet sync ---------- */
function musicResetPlayback() {
  const fill = document.getElementById('nc-progress-fill');
  if (fill) fill.style.width = '0%';
  document.querySelectorAll('#nc-sheet [data-note-play], #nc-attached [data-note-play]').forEach((b) => { b.textContent = '▶'; });
}

function musicSyncProgress() {
  const fill = document.getElementById('nc-progress-fill');
  const m = noteState.composerMusic;
  if (!fill || !m || !noteState.audio || !noteState.audio.duration) return;
  const clipLen = (m.duration && m.duration > 0) ? m.duration : musicFullLen(m);
  const t = Math.max(0, noteState.audio.currentTime - (m.start || 0));
  fill.style.width = `${Math.min(100, Math.max(0, (t / clipLen) * 100))}%`;
}

function musicUpdateClipChip(m) {
  const chip = document.getElementById('nc-clip-chip');
  if (!chip) return;
  const clipped = m.duration > 0;
  chip.textContent = clipped ? '30' : '∞';
  chip.classList.toggle('on', clipped);
  chip.setAttribute('aria-label', clipped ? 'Clip to 30 seconds (tap for full track)' : 'Full track (tap to clip 30 seconds)');
}

function musicRefreshComposerSheet() {
  const sheet = document.getElementById('nc-sheet');
  if (!sheet) return; // composer not upgraded yet
  const attached = document.getElementById('nc-attached');
  const m = noteState.composerMusic;
  if (!m) {
    sheet.hidden = true;
    if (attached) attached.hidden = true;
    return;
  }
  const art = m.art || '';
  const paint = (holderId, fallback) => {
    const holder = document.getElementById(holderId);
    if (!holder) return;
    holder.innerHTML = art ? `<img src="${escapeHtml(art)}" alt="" loading="lazy">` : fallback;
  };
  document.getElementById('nc-sheet-title').textContent = m.title;
  document.getElementById('nc-sheet-artist').textContent = m.artist;
  document.getElementById('nc-attached-title').textContent = m.title;
  document.getElementById('nc-attached-artist').textContent = m.artist;
  paint('nc-sheet-art', '♪');
  paint('nc-attached-art', '♪');
  musicUpdateClipChip(m);
  musicRenderWaveform(document.getElementById('nc-wave'), m);
  sheet.hidden = false;
  if (attached) attached.hidden = true;
  musicResetPlayback();
}

/* ---------- composer upgrade ---------- */
function notesUpgradeComposer() {
  const composer = document.getElementById('note-composer');
  if (!composer || composer.dataset.notesUpgraded) return;
  const card = composer.querySelector('.note-modal-card');
  if (!card) return;
  composer.dataset.notesUpgraded = '1';
  card.className = 'note-modal-card note-composer-card';
  card.innerHTML = `<button type="button" class="note-modal-close" data-close aria-label="Close">✕</button>
    <div class="nc-topbar">
      <span class="nc-top-spacer" aria-hidden="true"></span>
      <button type="button" class="nc-share" id="note-post">Share</button>
    </div>
    <div class="nc-body">
      <div class="nc-bubble">
        <textarea class="note-text nc-text" rows="1" placeholder="Note..." aria-label="Write a note"></textarea>
        <span class="nc-bubble-tail" aria-hidden="true"></span>
      </div>
      <div class="nc-avatar-wrap">
        <span class="nc-ring"><img class="nc-avatar" src="${escapeHtml(profile.avatar || '')}" alt="" onerror="this.style.visibility='hidden'"></span>
        <button type="button" class="nc-palette" id="nc-palette" aria-label="Add music">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 1 9-9c0 2.5-1.5 3.5-3 3.5h-2c-1 0-1.5.7-1.5 1.5 0 .4.2.8.5 1.2.4.5.7 1 .7 1.8 0 1-1 1-2 1z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/></svg>
        </button>
      </div>
      <div class="nc-actions">
        <button type="button" class="nc-action" id="nc-action-music" aria-label="Add music">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </button>
        <button type="button" class="nc-action" id="nc-action-location" aria-label="Add location">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </button>
        <button type="button" class="nc-action nc-action-gif" id="nc-action-gif" aria-label="Add GIF">GIF</button>
      </div>
    </div>
    <div class="nc-sheet" id="nc-sheet" hidden>
      <div class="nc-sheet-handle" aria-hidden="true"></div>
      <div class="nc-sheet-head">
        <button type="button" class="nc-sheet-new" id="nc-sheet-new">New song</button>
        <button type="button" class="nc-sheet-done" id="nc-sheet-done">Done</button>
      </div>
      <div class="nc-sheet-song">
        <span class="nc-sheet-art" id="nc-sheet-art">♪</span>
        <span class="nc-sheet-meta"><b id="nc-sheet-title"></b><em id="nc-sheet-artist"></em></span>
      </div>
      <div class="nc-timeline">
        <button type="button" class="nc-clip-chip" id="nc-clip-chip" aria-label="Clip to 30 seconds">30</button>
        <span class="nc-progress" aria-hidden="true"><i id="nc-progress-fill"></i></span>
        <button type="button" class="nc-play" id="nc-play" data-note-play aria-label="Play or pause">▶</button>
      </div>
      <div class="nc-wave" id="nc-wave" aria-hidden="true"></div>
    </div>
    <div class="nc-attached" id="nc-attached" hidden>
      <span class="nc-attached-art" id="nc-attached-art">♪</span>
      <span class="nc-attached-meta"><b id="nc-attached-title"></b><em id="nc-attached-artist"></em></span>
      <button type="button" class="nc-chip-btn" id="nc-attached-play" data-note-play aria-label="Play or pause">▶</button>
      <button type="button" class="nc-chip-btn" id="nc-attached-clear" aria-label="Remove music">✕</button>
    </div>`;

  const textEl = card.querySelector('.note-text');
  const grow = () => {
    textEl.style.height = 'auto';
    textEl.style.height = `${Math.min(textEl.scrollHeight, 120)}px`;
  };
  textEl.addEventListener('input', grow);
  grow();

  const openLib = () => musicOpenLibrary();
  document.getElementById('nc-palette').addEventListener('click', openLib);
  document.getElementById('nc-action-music').addEventListener('click', openLib);
  document.getElementById('nc-action-location').addEventListener('click', () => musicShowToast('Location stickers are coming soon.'));
  document.getElementById('nc-action-gif').addEventListener('click', () => musicShowToast('GIF stickers are coming soon.'));

  document.getElementById('nc-sheet-new').addEventListener('click', openLib);
  document.getElementById('nc-sheet-done').addEventListener('click', () => {
    document.getElementById('nc-sheet').hidden = true;
    document.getElementById('nc-attached').hidden = false;
    noteStop();
  });

  document.getElementById('nc-attached-play').addEventListener('click', (e) => {
    e.stopPropagation();
    if (noteState.composerMusic) notePlay(noteState.composerMusic, e.currentTarget);
  });
  document.getElementById('nc-attached-clear').addEventListener('click', () => {
    noteState.composerMusic = null;
    document.getElementById('nc-sheet').hidden = true;
    document.getElementById('nc-attached').hidden = true;
    noteStop();
  });

  document.getElementById('nc-play').addEventListener('click', (e) => {
    e.stopPropagation();
    if (noteState.composerMusic) notePlay(noteState.composerMusic, e.currentTarget);
  });

  document.getElementById('nc-clip-chip').addEventListener('click', () => {
    const m = noteState.composerMusic;
    if (!m) return;
    if (m.duration > 0) {
      m.duration = 0; // full track
    } else {
      m.duration = 30;
      if (typeof m.start !== 'number') m.start = 0;
    }
    musicUpdateClipChip(m);
    musicRenderWaveform(document.getElementById('nc-wave'), m);
    musicResetPlayback();
  });

  // Keep the timeline + play buttons in sync with the shared audio element.
  if (noteState.audio) {
    noteState.audio.addEventListener('timeupdate', musicSyncProgress);
    noteState.audio.addEventListener('play', () => {
      document.querySelectorAll('#nc-sheet [data-note-play], #nc-attached [data-note-play]').forEach((b) => { b.textContent = '❚❚'; });
    });
    noteState.audio.addEventListener('pause', () => {
      document.querySelectorAll('#nc-sheet [data-note-play], #nc-attached [data-note-play]').forEach((b) => { b.textContent = '▶'; });
    });
    noteState.audio.addEventListener('ended', musicResetPlayback);
  }

  // Share = post the note (mirrors main.js's original handler).
  document.getElementById('note-post').addEventListener('click', () => {
    const text = textEl.value.trim();
    if (!text) { textEl.focus(); return; }
    const m = noteState.composerMusic;
    userNotes.unshift({
      id: Date.now(),
      author: profile.username,
      avatar: profile.avatar,
      text,
      music: m ? { title: m.title, artist: m.artist, genre: m.genre, videoId: m.videoId || null, url: m.url || null, art: m.art || null, source: m.source || null, start: m.start, duration: m.duration } : null,
      createdAt: Date.now()
    });
    saveNotes();
    noteState.composerMusic = null;
    textEl.value = '';
    composer.hidden = true;
    noteStop();
    renderNoteShelves();
  });
}

/* ---------- bootstrap: upgrade as soon as main.js builds the modals ---------- */
(function musicInit() {
  let done = false;
  const upgrade = () => {
    if (done) return;
    notesUpgradeComposer();
    musicUpgradeLibrary();
    if (document.getElementById('note-composer') && document.getElementById('music-library')) {
      done = true;
    }
  };
  upgrade();
  if (!done && typeof MutationObserver === 'function') {
    const obs = new MutationObserver(() => {
      upgrade();
      if (done) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } else if (!done) {
    const timer = setInterval(() => {
      upgrade();
      if (done) clearInterval(timer);
    }, 250);
  }
})();
