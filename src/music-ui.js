/* GlitchIt — Music picker redesign (Spotify-style music sheet)
   Loaded AFTER src/main.js on pages that can open the note composer
   (messages, profile, home). Overrides the global renderTrackRows /
   renderMusicLibrary / searchWeb functions from main.js so the "Add music"
   sheet looks like a modern music search: a pill search bar with a
   magnifier icon, For you / Trending / Saved tabs, a dismissible
   "Link Spotify" banner, and song rows with artwork, explicit badges,
   durations, and bookmark (save) buttons.

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
  fetch('api/music?chart=1')
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
  fetch(`api/music?q=${encodeURIComponent(q)}`)
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
      noteState.composerMusic = t;
      document.getElementById('note-music-title').textContent = t.title;
      document.getElementById('note-music-artist').textContent = `${t.artist} · ${t.genre}`;
      const chipBtn = document.getElementById('note-music-play');
      chipBtn.dataset.id = t.url || '';
      const trimRow = document.getElementById('note-trim-row');
      if (trimRow) {
        const startInput = document.getElementById('note-trim-start');
        const lenInput = document.getElementById('note-trim-len');
        startInput.value = (typeof t.start === 'number' && t.duration > 0) ? t.start : 0;
        lenInput.value = (typeof t.duration === 'number' && t.duration > 0) ? t.duration : 30;
        trimRow.hidden = false;
        applyTrim();
      }
      document.getElementById('note-music-row').hidden = false;
      document.getElementById('music-library').hidden = true;
      noteStop();
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

/* ---------- bootstrap: upgrade as soon as main.js creates the library modal ---------- */
(function musicInit() {
  let upgraded = false;
  const upgrade = () => {
    if (upgraded) return;
    const library = document.getElementById('music-library');
    if (!library) return;
    upgraded = true;
    musicUpgradeLibrary();
  };
  upgrade();
  if (!upgraded && typeof MutationObserver === 'function') {
    const obs = new MutationObserver(() => {
      upgrade();
      if (upgraded) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } else if (!upgraded) {
    const timer = setInterval(() => {
      upgrade();
      if (upgraded) clearInterval(timer);
    }, 250);
  }
})();
