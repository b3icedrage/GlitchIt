// GlitchIt — Discover channels (src/channels.js).
// Loaded on channels.html (after main.js). Renders the channel discovery
// screen: a featured topic card, filterable topic chips, and two channel
// lists (Suggested for you / Popular now) with Join buttons. Joins persist
// per-device in localStorage so the app stays dependency-free.
(function () {
  'use strict';

  const JOIN_KEY = 'glitchit.joined.channels';

  const TOPICS = [
    { id: 'fashion', label: 'Fashion', emoji: '👚' },
    { id: 'art', label: 'Art', emoji: '🎨' },
    { id: 'music', label: 'Music', emoji: '🎵' },
    { id: 'people', label: 'People', emoji: '👥' },
    { id: 'gaming', label: 'Gaming', emoji: '🎮' },
    { id: 'sports', label: 'Sports', emoji: '⚽' },
    { id: 'movies', label: 'Movies', emoji: '🎬' },
    { id: 'comedy', label: 'Comedy', emoji: '😹' },
  ];

  // ring: white (default) | gold | blue — matches the reference rings.
  const CHANNELS = [
    { id: 'wachawi', name: 'Wachawi', emoji: '👽', ring: 'white', grad: ['#ff9a3d', '#ff2e88'], handle: '_.ronoo', members: 9008, topic: 'people', popular: false },
    { id: 'g64', name: '64_group', emoji: '🥋', ring: 'gold', grad: ['#f5c542', '#8a6d1a'], handle: 'edit_brucelee', members: 1228, topic: 'sports', popular: false },
    { id: 'fashiondaily', name: 'FashionDaily', emoji: '👗', ring: 'white', grad: ['#ec4899', '#7c3aed'], handle: 'runway.edit', members: 45200, topic: 'fashion', popular: false },
    { id: 'streetwear', name: 'StreetWear', emoji: '👟', ring: 'white', grad: ['#f59e0b', '#ef4444'], handle: 'hype.kicks', members: 18400, topic: 'fashion', popular: false },
    { id: 'artgallery', name: 'ArtGallery', emoji: '🎨', ring: 'white', grad: ['#06b6d4', '#8b5cf6'], handle: 'canvas.daily', members: 32700, topic: 'art', popular: false },
    { id: 'glitchmusic', name: 'GlitchMusic', emoji: '🎵', ring: 'white', grad: ['#22c55e', '#0ea5e9'], handle: 'glitch.beats', members: 27600, topic: 'music', popular: false },
    { id: 'futboledits', name: 'FutbolEdits', emoji: '⚽', ring: 'blue', grad: ['#22c55e', '#15803d'], handle: 'top.footy', members: 96800, topic: 'sports', popular: false },
    { id: 'comedylounge', name: 'ComedyLounge', emoji: '😹', ring: 'white', grad: ['#f97316', '#e11d48'], handle: 'funny.frames', members: 210400, topic: 'comedy', popular: false },
    { id: 'wwe', name: 'WWE', emoji: '🏟️', ring: 'white', grad: ['#ef4444', '#7f1d1d'], handle: 'wwe', members: 1100000, topic: 'sports', popular: true, verified: true },
    { id: 'gamingzone', name: 'GamingZone', emoji: '🎮', ring: 'white', grad: ['#8b5cf6', '#312e81'], handle: 'gz.arena', members: 820000, topic: 'gaming', popular: true, verified: true },
    { id: 'movieclips', name: 'MovieClips', emoji: '🎬', ring: 'blue', grad: ['#3b82f6', '#1e3a8a'], handle: 'cinema.cuts', members: 640000, topic: 'movies', popular: true },
    { id: 'dailydrip', name: 'DailyDrip', emoji: '🛍️', ring: 'gold', grad: ['#f472b6', '#be185d'], handle: 'fit.check', members: 318000, topic: 'fashion', popular: true },
    { id: 'scripted', name: 'Scripted', emoji: '🎭', ring: 'white', grad: ['#a855f7', '#6b21a8'], handle: 'cinema.stories', members: 156000, topic: 'movies', popular: true },
  ];

  const state = {
    topic: '',
    expanded: { suggested: false, popular: false },
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtCount(n) {
    const num = Number(n) || 0;
    if (num >= 1e6) {
      const v = num / 1e6;
      return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (num >= 1e3) {
      const v = num / 1e3;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}K`;
    }
    return num.toLocaleString('en-US');
  }

  function verifiedBadge() {
    return '<span class="ch-verified" aria-label="Verified channel"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';
  }

  function readJoined() {
    try {
      const raw = JSON.parse(localStorage.getItem(JOIN_KEY) || '[]');
      return Array.isArray(raw) ? new Set(raw) : new Set();
    } catch (err) {
      return new Set();
    }
  }

  function writeJoined(set) {
    try {
      localStorage.setItem(JOIN_KEY, JSON.stringify([...set]));
    } catch (err) { /* storage unavailable — joins are session-only */ }
  }

  function channelRow(ch, joined) {
    return `
      <div class="ch-row" data-id="${esc(ch.id)}">
        <span class="ch-avatar ring-${esc(ch.ring)}" style="background:linear-gradient(135deg,${esc(ch.grad[0])},${esc(ch.grad[1])})" aria-hidden="true"><i>${esc(ch.emoji)}</i></span>
        <div class="ch-meta">
          <strong>${esc(ch.name)} ${esc(ch.emoji)}${ch.verified ? verifiedBadge() : ''}</strong>
          <em>${esc(ch.handle)} • ${fmtCount(ch.members)} members</em>
        </div>
        <button type="button" class="ch-join${joined ? ' joined' : ''}" data-join="${esc(ch.id)}" aria-pressed="${joined ? 'true' : 'false'}">${joined ? 'Joined ✓' : 'Join'}</button>
      </div>`;
  }

  function renderTopics(container, activeId) {
    container.innerHTML = TOPICS.map((t) => `
      <button type="button" class="ch-topic${t.id === activeId ? ' active' : ''}" data-topic="${esc(t.id)}" aria-pressed="${t.id === activeId ? 'true' : 'false'}">
        <span aria-hidden="true">${esc(t.emoji)}</span>${esc(t.label)}
      </button>`).join('');
  }

  function renderList(listEl, channels, expanded) {
    const joined = readJoined();
    const visible = expanded ? channels : channels.slice(0, 3);
    if (visible.length === 0) {
      listEl.innerHTML = '<div class="ch-empty">No channels in this topic yet — check back soon.</div>';
    } else {
      listEl.innerHTML = visible.map((ch) => channelRow(ch, joined.has(ch.id))).join('');
    }
    const head = listEl.closest('.channels-section');
    const seeAll = head && head.querySelector('.ch-seeall');
    if (seeAll) {
      seeAll.textContent = expanded ? 'Show less' : 'See all';
    }
  }

  function renderAll() {
    const topicsEl = document.getElementById('ch-topics');
    const suggestedEl = document.getElementById('ch-suggested');
    const popularEl = document.getElementById('ch-popular');
    if (!topicsEl || !suggestedEl || !popularEl) return;

    renderTopics(topicsEl, state.topic);

    let suggested = CHANNELS.filter((ch) => !ch.popular);
    let popular = CHANNELS.filter((ch) => ch.popular);
    if (state.topic) {
      suggested = suggested.filter((ch) => ch.topic === state.topic);
      popular = popular.filter((ch) => ch.topic === state.topic);
    }

    renderList(suggestedEl, suggested, state.expanded.suggested);
    renderList(popularEl, popular, state.expanded.popular);
  }

  function boot() {
    const topicsEl = document.getElementById('ch-topics');
    if (!topicsEl) return;

    topicsEl.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-topic]');
      if (!chip) return;
      state.topic = state.topic === chip.dataset.topic ? '' : chip.dataset.topic;
      state.expanded = { suggested: false, popular: false };
      renderAll();
    });

    document.addEventListener('click', (event) => {
      const seeAll = event.target.closest('.ch-seeall');
      if (seeAll) {
        const key = seeAll.dataset.seeall;
        if (key === 'suggested' || key === 'popular') {
          state.expanded[key] = !state.expanded[key];
          renderAll();
        }
        return;
      }
      const join = event.target.closest('[data-join]');
      if (join) {
        const joined = readJoined();
        if (joined.has(join.dataset.join)) {
          joined.delete(join.dataset.join);
        } else {
          joined.add(join.dataset.join);
        }
        writeJoined(joined);
        renderAll();
      }
    });

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
