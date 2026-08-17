// GlitchIt — the AI creator.
// A pinned, verified creator (@glitchit) that posts a fresh AI-themed video
// every minute while a feed is open. Runs client-side: every clip is REAL
// footage of physical characters — people dancing and moving on real
// streets — and each post gets deterministic cinematic poster art, a caption
// and trending stats. The live row is appended below any real cloud posts —
// real videos always sit above it — and is never removed once shown.
(function () {
  'use strict';

  const ROOT_CLASS = 'glitchit-root';
  const OFF_KEY = 'glitchit.bot.off';

  // Real-footage clips of PHYSICAL characters — people in motion, on real
  // streets (live-action Chromecast ads, which have audio, plus Mixkit's
  // free-license urban dancer clips).
  const CLIPS = [
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    'https://assets.mixkit.co/videos/276/276-720.mp4',
    'https://assets.mixkit.co/videos/441/441-720.mp4',
    'https://assets.mixkit.co/videos/51306/51306-720.mp4',
    'https://assets.mixkit.co/videos/51298/51298-720.mp4',
    'https://assets.mixkit.co/videos/51303/51303-720.mp4',
  ];

  const AI_VERBS = ['directed', 'graded', 'framed', 'cut', 'composed', 'stabilized', 'color-graded', 'followed'];
  const AI_ADJ = ['cinematic', 'golden-hour', 'street-level', 'night', 'urban', 'soulful', 'energetic', 'raw'];
  const AI_NOUNS = ['street dancer', 'city dancer', 'dance crew', 'dancer at night', 'street performer', 'urban dancer', 'mover in the city', 'dancer under neon', 'night dancer', 'street character'];
  const AI_TITLE_TPL = [
    'AI {verb} a {adj} {noun}',
    'The {adj} {noun} — AI cut',
    '{noun} but shot by AI',
    'Neural {noun} take',
    'AI camera: {adj} {noun}',
    '{adj} {noun} in 4K',
    'AI {verb} — {noun}',
    '{adj} {noun} — trending',
  ];
  const AI_TAGS = ['ai', 'aivideo', 'aiart', 'cinematic', 'neural', 'trending', 'glitchit'];

  // ---------- deterministic PRNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---------- helpers ----------
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }
  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }
  function svgUri(svg) {
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function gradient(id, c1, c2) {
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>`;
  }
  function htmlToNode(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function enabled() {
    try { return localStorage.getItem(OFF_KEY) !== '1'; } catch (e) { return true; }
  }

  const GLITCHIT_ID = 'glitchit';
  const GLITCHIT_HANDLE = 'glitchit';
  const GLITCHIT_AVATAR = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${gradient('giglitchit', '#6366f1', '#06b6d4')}<circle cx="48" cy="48" r="48" fill="url(#giglitchit)"/><text x="48" y="60" font-size="42" text-anchor="middle">⚡</text></svg>`
  );

  // Cinematic film-still poster: deep color grade, soft light leaks, grain.
  function poster(seed, title) {
    const rng = mulberry32(seed);
    const hue = Math.floor(rng() * 360);
    const gid = 'gp' + seed;
    const c1 = `hsl(${hue} 45% 34%)`;
    const c2 = `hsl(${(hue + 40) % 360} 55% 12%)`;
    const leaks = Array.from({ length: 3 }, () => {
      const x = Math.floor(rng() * 300);
      const w = 20 + Math.floor(rng() * 70);
      return `<rect x="${x}" y="${80 + Math.floor(rng() * 300)}" width="${w}" height="2" fill="rgba(255,255,255,.25)"/>`;
    }).join('');
    const grain = Array.from({ length: 6 }, () => {
      const x = Math.floor(rng() * 390);
      const y = Math.floor(rng() * 490);
      return `<circle cx="${x}" cy="${y}" r="1" fill="rgba(255,255,255,.35)"/>`;
    }).join('');
    return svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">${gradient(gid, c1, c2)}<rect width="400" height="500" fill="url(#${gid})"/><rect width="400" height="500" fill="rgba(0,0,0,.35)"/>${leaks}${grain}<text x="24" y="58" font-size="15" letter-spacing="5" fill="rgba(255,255,255,.75)" font-family="sans-serif" font-weight="700">AI VIDEO</text><text x="200" y="420" font-size="24" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="800">${esc(title.slice(0, 30))}</text><text x="200" y="448" font-size="13" text-anchor="middle" fill="rgba(255,255,255,.65)" font-family="sans-serif">@glitchit · neural grade</text></svg>`
    );
  }

  // The n-th AI post (n = minutes ago it was "published"). Every clip is
  // real footage with sound; title, caption, poster and stats are unique.
  function videoAt(n) {
    const seed = hashStr('glitchit-ai:' + n);
    const rng = mulberry32(seed);
    const title = pick(rng, AI_TITLE_TPL)
      .replace('{verb}', pick(rng, AI_VERBS))
      .replace('{adj}', pick(rng, AI_ADJ))
      .replace('{noun}', pick(rng, AI_NOUNS));
    const tags = [...AI_TAGS].sort(() => rng() - 0.5).slice(0, 3);
    const caption = `${title}${tags.map((t) => ' #' + t).join('')}`;
    return {
      id: GLITCHIT_ID + '-ai-' + n,
      title,
      caption,
      src: CLIPS[n % CLIPS.length],
      poster: poster(seed, title),
      user: GLITCHIT_HANDLE,
      display: 'GlitchIt',
      avatar: GLITCHIT_AVATAR,
      verified: true,
      owner: GLITCHIT_ID,
      likes: String(1400 + Math.floor(rng() * 9600)),
      comments: String(120 + Math.floor(rng() * 900)),
      shares: String(60 + Math.floor(rng() * 700)),
      created_at: Date.now() - n * 60000,
    };
  }

  function buildRoot(container) {
    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    const row = document.createElement('div');
    row.className = 'glitchit-row';
    const bolt = typeof window.verifiedBolt === 'function' ? window.verifiedBolt('verified-bolt-inline') : '';
    row.innerHTML = `<span class="glitchit-avatar"><img src="${GLITCHIT_AVATAR}" alt="GlitchIt avatar"></span><div class="glitchit-meta"><strong>GlitchIt${bolt}</strong><span class="glitchit-status"><i class="glitchit-dot" aria-hidden="true"></i><em class="glitchit-status-text">AI creator · new video every minute</em></span></div><b class="glitchit-count">…</b><button type="button" class="glitchit-hide" aria-label="Hide GlitchIt">Hide</button>`;
    const live = document.createElement('div');
    live.className = 'glitchit-live';
    root.appendChild(row);
    root.appendChild(live);

    const countEl = row.querySelector('.glitchit-count');
    const attach = () => {
      if (typeof window.attachGlitchAutoplay === 'function') window.attachGlitchAutoplay();
      if (typeof window.attachReelsActions === 'function') window.attachReelsActions();
      if (typeof window.markSavedReels === 'function') window.markSavedReels();
    };
    const card = (v, newest) => {
      if (typeof window.glitchVideoCard !== 'function') return null;
      const node = htmlToNode(window.glitchVideoCard({
        id: v.id, title: v.title, caption: v.caption, src: v.src, poster: v.poster,
        user: v.user, avatar: v.avatar, verified: v.verified, owner: v.owner,
        likes: v.likes, comments: v.comments, shares: v.shares,
      }));
      if (newest) node.classList.add('glitchit-new');
      return node;
    };
    // Local stock-clip fallback (used only while the AI pipeline is off).
    const refreshStock = () => {
      const node = card(videoAt(postIndex), true);
      if (!node) return;
      live.prepend(node);
      while (live.children.length > 12) live.lastChild.remove();
      if (countEl) countEl.textContent = `${live.children.length} fresh`;
      attach();
    };

    // Backfill the last six minutes so the creator isn't silent on load
    // (newest first, matching the live order).
    for (let i = 5; i >= 0; i--) {
      const node = card(videoAt(i), false);
      if (node) live.prepend(node);
    }
    if (countEl) countEl.textContent = `${live.children.length} fresh`;
    attach();
    let postIndex = 6;

    // ---- AI pipeline: ask the serverless endpoint for freshly generated
    // videos. Real AI clips replace the stock fallback whenever available.
    const statusEl = row.querySelector('.glitchit-status-text');
    const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };
    let aiMode = false;
    let lastAiUrl = '';

    const prependAi = (v) => {
      const node = card({
        id: v.id || 'glitchit-ai-' + Date.now(),
        title: v.title || 'AI video',
        caption: v.caption || `${v.title || 'AI video'} #ai #aivideo`,
        src: v.url,
        poster: v.poster || v.url,
        user: GLITCHIT_HANDLE,
        avatar: GLITCHIT_AVATAR,
        verified: true,
        owner: GLITCHIT_ID,
        likes: '0', comments: '0', shares: '0',
      }, true);
      if (!node) return;
      live.prepend(node);
      while (live.children.length > 12) live.lastChild.remove();
      if (countEl) countEl.textContent = `${live.children.length} fresh`;
      attach();
    };

    const pumpAi = async () => {
      let res = null;
      try {
        const r = await fetch('/api/glitchit-video', { cache: 'no-store' });
        if (r.ok) res = await r.json();
      } catch (err) { res = null; }
      if (res && res.ok && res.ai) {
        if (res.error) { aiMode = false; setStatus('AI creator · new video every minute'); return; }
        aiMode = true;
        if (res.video && res.video.url && res.video.url !== lastAiUrl) {
          lastAiUrl = res.video.url;
          prependAi(res.video);
          setStatus('AI video just generated');
        } else if (res.generating) {
          setStatus('AI is generating the next video…');
        }
      } else {
        // Endpoint unavailable (no key / preview without the function) —
        // keep the local realistic clips flowing.
        aiMode = false;
        setStatus('AI creator · new video every minute');
      }
    };

    const stockTimer = setInterval(() => { if (root.isConnected && !aiMode) refreshStock(); }, 60000);
    const aiTimer = setInterval(() => { if (root.isConnected) pumpAi(); }, 60000);
    pumpAi();

    row.querySelector('.glitchit-hide')?.addEventListener('click', () => {
      clearInterval(stockTimer);
      clearInterval(aiTimer);
      try { localStorage.setItem(OFF_KEY, '1'); } catch (e) { /* ignore */ }
      root.remove();
    });
    return root;
  }

  // Feeds: keep the AI creator up no matter what loads around it. Real cloud
  // posts are never touched — they sit above the live row. If the container
  // is replaced (local uploads, empty states), the row is re-added.
  function observeContainer(container) {
    if (!container) return;
    const tryInject = () => {
      if (!enabled()) return;
      if (container.querySelector('.' + ROOT_CLASS)) return; // already up — never duplicated or removed
      container.querySelector('.feed-empty, .rail-empty, .sr-empty')?.remove();
      container.appendChild(buildRoot(container));
    };
    const observer = new MutationObserver(tryInject);
    observer.observe(container, { childList: true, subtree: true });
    [0, 300, 900, 1800, 3200].forEach((delay) => setTimeout(tryInject, delay));
  }

  function init() {
    const page = document.body.dataset.page || 'home';
    if (page === 'home') observeContainer(document.getElementById('upload-feed'));
    if (page === 'glitches') observeContainer(document.getElementById('video-feed'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
