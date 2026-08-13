// GlitchIt — shared multi-page app script.
// Every screen lives in its own HTML file (index, search, glitches, messages, activity,
// profile, shop). This script detects the current page via <body data-page="...">
// and hydrates only the interactions that page needs. Uploads and theme are persisted
// in localStorage so state carries over when you move between pages.

/* ============================================================
   GlitchIt platform bootstrap — error tracking (Sentry), global
   error capture and the service-worker caching layer. Runs first
   on every page (main.js is loaded by all HTML files).
   ============================================================ */
(function bootstrapGlitchItPlatform() {
  // Caching layer: register the service worker (offline + fast repeat loads).
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none', scope: './' })
        .catch((err) => { console.warn('GlitchIt: service worker registration failed', err); reportError(err, { phase: 'sw-register' }); });
    } catch (err) { /* never let this block the app */ }
  }

  // Global error + promise-rejection capture. Works before Sentry finishes
  // loading; forwards to Sentry once it's ready.
  function reportError(err, extra) {
    try {
      if (window.Sentry) {
        const ex = err instanceof Error ? err : new Error(String(err));
        if (extra) ex.extra = extra;
        window.Sentry.captureException(ex);
      } else {
        console.warn('[GlitchIt error]', err, extra || '');
      }
    } catch (e) { /* monitoring must never break the app */ }
  }
  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, { source: String((event.target && event.target.tagName) || '') });
  });
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

  // Public monitoring hooks for the rest of the app: any module (db/auth/network)
  // can report failures, and the signed-in user is tagged on errors for context.
  // Both are no-ops when Sentry is off (DSN empty in src/config.js).
  window.GLITCHIT_REPORT = reportError;
  window.GLITCHIT_IDENTIFY = (user) => {
    try {
      if (!window.Sentry || !user) return;
      const meta = user.user_metadata || {};
      window.Sentry.setUser({ id: user.id || '', username: meta.username || user.email || '' });
    } catch (e) { /* monitoring must never break the app */ }
  };

  // Sentry SDK: loaded async so it never blocks first paint. It only activates
  // when a DSN is configured in src/config.js (public client key, like the
  // Supabase anon key). Errors before it resolves are reported on the console.
  const bundle = document.createElement('script');
  bundle.src = 'https://browser.sentry-cdn.com/10.69.0/bundle.tracing.min.js';
  bundle.crossOrigin = 'anonymous';
  bundle.onload = () => {
    import('./config.js?v=6').then((cfg) => {
      if (!cfg || !cfg.SENTRY_DSN || !window.Sentry) return;
      window.Sentry.init({
        dsn: cfg.SENTRY_DSN,
        environment: (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'development' : 'production',
        release: 'glitchit@1.0.0',
        tracesSampleRate: 0.2,
        integrations: [window.Sentry.browserTracingIntegration()],
      });
      console.info('GlitchIt: Sentry monitoring enabled');
    }).catch(() => {});
  };
  bundle.onerror = () => {};
  document.head.appendChild(bundle);
})();

const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;

// Instagram-Reels style line icons (heart / comment / send) used on glitch cards.
const reelIcon = (kind) => kind === 'heart'
  ? '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
  : kind === 'comment'
  ? '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  : kind === 'bookmark'
  ? '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
  : '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 22-7z"/></svg>';

function fallbackAvatar(label = 'GlitchIt') {
  const initials = String(label).trim().split(/[^a-z0-9]+/i).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'G';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#g)"/><text x="60" y="67" fill="white" font-family="Arial,sans-serif" font-size="38" font-weight="700" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function safeAvatar(value) {
  const url = String(value || '').trim();
  if (!url || /[<>"']/.test(url) || !/^(?:https?:\/\/|data:image\/|blob:)/i.test(url)) return '';
  return url;
}

function userAvatar(user, handle = '') {
  const metadata = user?.user_metadata || {};
  const identity = user?.identities?.[0]?.identity_data || {};
  return [metadata.avatar_url, metadata.picture, metadata.avatar, metadata.image, identity.avatar_url, identity.picture]
    .map(safeAvatar)
    .find(Boolean) || fallbackAvatar(handle || user?.email?.split('@')[0] || 'GlitchIt');
}

const profile = {
  username: 'you',
  name: 'You',
  avatar: fallbackAvatar('you'),
};

// ---------- GlitchIt Verified (Pro entitlement) + creator analytics ----------
let meVerified = false;        // cached own status, used by sync renders
let verifiedCheck = null;      // one shared RevenueCat probe per page load
function isVerifiedUser() {
  if (!verifiedCheck) {
    verifiedCheck = import('./revenuecat.js?v=5').then((rc) => rc.isPro()).catch(() => false);
  }
  return verifiedCheck;
}

const fmtCount = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(v));
};

// Professional-account qualification thresholds.
const PRO_FOLLOWERS_MIN = 100000;
const PRO_WATCH_HOURS_MIN = 5000;
const PRO_VIEWS_MIN = 500000;

// Creator analytics live in localStorage per owner (client-side, no backend
// needed at this stage). Defaults are honest zeros, so the professional
// dashboard shows real progress until the thresholds are met.
const PRO_STATS_KEY = (userId) => `glitchit.pro.stats.${userId}`;
function readProfileStats(userId) {
  if (!userId) return { followers: 0, following: 0, watchHours: 0, views: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(PRO_STATS_KEY(userId)) || '{}') || {};
    return {
      followers: Math.max(0, Number(s.followers) || 0),
      following: Math.max(0, Number(s.following) || 0),
      watchHours: Math.max(0, Number(s.watchHours) || 0),
      views: Math.max(0, Number(s.views) || 0),
    };
  } catch (e) { return { followers: 0, following: 0, watchHours: 0, views: 0 }; }
}
function writeProfileStats(userId, stats) {
  try { localStorage.setItem(PRO_STATS_KEY(userId), JSON.stringify(stats)); } catch (e) { /* ignore */ }
}
function recordFollow(targetId) {
  if (!targetId || targetId === window.GLITCHIT_USER?.id) return;
  const s = readProfileStats(targetId);
  s.followers += 1;
  writeProfileStats(targetId, s);
}

// Persistent follow state for the signed-in user (who they follow), so the
// Follow/Following toggle survives navigation and every follow button in the
// app agrees on the same state.
const FOLLOWING_KEY = (myId) => `glitchit.following.${myId}`;
function readFollowing() {
  const me = window.GLITCHIT_USER;
  if (!me || me.guest) return [];
  try {
    const arr = JSON.parse(localStorage.getItem(FOLLOWING_KEY(me.id)) || '[]');
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch (e) { return []; }
}
function isFollowing(targetId) {
  return readFollowing().includes(String(targetId));
}
// Follow (on=true) or unfollow (on=false) a creator. Persists the list, bumps
// the target's follower count, and adjusts the signed-in user's own following
// count so both profiles stay honest.
function setFollowing(targetId, on) {
  const me = window.GLITCHIT_USER;
  if (!me || me.guest || !targetId || targetId === me.id) return false;
  const id = String(targetId);
  let list = readFollowing();
  const was = list.includes(id);
  if (on === was) return true;
  list = on ? [...list, id] : list.filter((x) => x !== id);
  try { localStorage.setItem(FOLLOWING_KEY(me.id), JSON.stringify(list)); } catch (e) { /* ignore */ }
  const mine = readProfileStats(me.id);
  mine.following = Math.max(0, (Number(mine.following) || 0) + (on ? 1 : -1));
  writeProfileStats(me.id, mine);
  if (on) {
    recordFollow(targetId);
  } else {
    const theirs = readProfileStats(targetId);
    theirs.followers = Math.max(0, (Number(theirs.followers) || 0) - 1);
    writeProfileStats(targetId, theirs);
  }
  return true;
}
function recordView(ownerId) {
  if (!ownerId) return;
  const s = readProfileStats(ownerId);
  s.views += 1;
  writeProfileStats(ownerId, s);
}
function recordWatch(ownerId, seconds) {
  if (!ownerId || !(Number(seconds) > 0)) return;
  const s = readProfileStats(ownerId);
  s.watchHours += Number(seconds) / 3600;
  writeProfileStats(ownerId, s);
}

// The ⚡ badge element shown beside Verified members' avatars.
function verifiedBolt(extraClass = '') {
  return `<span class="verified-bolt ${extraClass}" aria-label="GlitchIt Verified" title="GlitchIt Verified">⚡</span>`;
}

// Puts the ⚡ badge on the signed-in user's own avatars (right rail, profile
// photo, account sheet, nav icons, story ring) once they're verified.
function applyVerifiedBadges(verified) {
  if (!verified) return;
  const wrapImage = (img) => {
    if (!img || img.closest('.verified-avatar-holder')) return;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (!w || !h) return;
    const holder = document.createElement('span');
    holder.className = 'verified-avatar-holder';
    holder.style.width = `${w}px`;
    holder.style.height = `${h}px`;
    img.replaceWith(holder);
    holder.appendChild(img);
    const bolt = document.createElement('span');
    bolt.className = 'verified-bolt';
    bolt.textContent = '⚡';
    bolt.setAttribute('aria-label', 'GlitchIt Verified');
    bolt.title = 'GlitchIt Verified';
    holder.appendChild(bolt);
  };
  document.querySelectorAll('.me img, .account-avatar img, .bottom-bar a[href="profile.html"] .profile-nav-avatar, .sidebar nav a[href="profile.html"] .profile-nav-avatar, .story-self .story-ring img').forEach(wrapImage);
  // Profile photo: the wrap is position:relative, so bolt goes straight inside
  // it (keeps the direct-child sizing rules intact).
  const photo = document.querySelector('.profile-photo-wrap');
  if (photo && !photo.querySelector(':scope > .verified-bolt')) {
    photo.insertAdjacentHTML('beforeend', verifiedBolt());
  }
}

function syncProfileFromUser(user) {
  if (!user || user.guest) return;
  const metadata = user.user_metadata || {};
  const handle = metadata.username || user.email?.split('@')[0] || user.id || profile.username;
  profile.username = handle;
  profile.name = metadata.full_name || metadata.name || handle;
  profile.avatar = userAvatar(user, handle);
}

function applyProfileAvatarUi() {
  const handle = profile.username || 'your account';
  const avatar = profile.avatar || fallbackAvatar(handle);
  document.querySelectorAll('.me img, .profile-photo-wrap > img, .account-sheet-avatar').forEach((image) => {
    image.src = avatar;
    image.alt = `${handle} profile picture`;
  });
  document.querySelectorAll('.right-rail .me strong, .me strong').forEach((el) => { el.textContent = handle; });
  document.querySelectorAll('.right-rail .me span, .me span').forEach((el) => {
    if (!el.textContent.trim() || el.textContent.trim() === 'Build your vibe') {
      el.textContent = window.GLITCHIT_USER?.email || 'GlitchIt creator';
    }
  });
  document.querySelectorAll('.handle-text').forEach((el) => { el.textContent = handle; });

  document.querySelectorAll('a[href="profile.html"]').forEach((link) => {
    if (!link.closest('.bottom-bar, .sidebar nav')) return;
    const oldIcon = link.querySelector('.icon, svg');
    if (!oldIcon) return;
    const image = document.createElement('img');
    image.className = 'profile-nav-avatar';
    image.src = avatar;
    image.alt = `${handle} profile`;
    oldIcon.replaceWith(image);
  });
}

function applyCurrentUserProfile() {
  syncProfileFromUser(window.GLITCHIT_USER);
  applyProfileAvatarUi();
}

// Map a stored owner UUID back to a friendly handle for display.
function displayUser(owner) {
  const u = window.GLITCHIT_USER;
  if (u && owner === u.id) return u.user_metadata?.username || u.email?.split('@')[0] || owner;
  return owner || '';
}

// ---------- Real data + empty states ----------
// Fills the right rail with the signed-in user's real stats and the list of
// real creators (distinct people who have posted). Shows empty states when
// there is no data yet, so no fake accounts are ever rendered.
async function hydrateRail() {
  const user = window.GLITCHIT_USER;
  const followers = document.querySelector('[data-stat="followers"]');
  const drops = document.querySelector('[data-stat="drops"]');
  if (drops) drops.textContent = String(user && !user.guest && DB ? await DB.countMedia(user.id) : 0);
  if (followers) followers.textContent = fmtCount(readProfileStats(user && !user.guest ? user.id : null).followers);

  const list = document.querySelector('.rail-suggestions');
  if (!list) return;
  const creators = DB ? await DB.loadCreators(4) : [];
  const others = creators.filter((c) => !user || c.id !== user.id);
  if (!others.length) {
    list.innerHTML = '<div class="rail-empty"><span class="rail-empty-mark">ϟ</span><p>No creators yet</p><small>Creators who post will show up here.</small></div>';
    return;
  }
  list.innerHTML = others.map((c) => {
    const handle = escapeHtml(c.handle || String(c.id).slice(0, 8));
    const avatar = c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="${handle} avatar" loading="lazy">` : `<span class="badge" aria-hidden="true"><i>${escapeHtml(handle[0]?.toUpperCase() || 'G')}</i></span>`;
    return `<div class="seller" data-owner="${escapeHtml(c.id)}"><div><strong>${handle}${c.verified ? verifiedBolt('verified-bolt-inline') : ''}</strong><span>Creator</span></div><button type="button">Follow</button></div>`;
  }).join('');
  list.querySelectorAll('.seller button').forEach((btn) => {
    const ownerId = btn.closest('.seller')?.dataset.owner;
    const syncBtn = () => {
      const on = isFollowing(ownerId);
      btn.classList.toggle('following', on);
      btn.textContent = on ? 'Following' : 'Follow';
    };
    syncBtn();
    btn.addEventListener('click', () => {
      if (!ownerId) return;
      setFollowing(ownerId, !isFollowing(ownerId));
      syncBtn();
    });
  });
}

// Search page: real accounts derived from the media table. By default they are
// ranked by follower count (most -> lowest); once the user types a query they
// are filtered and re-sorted alphabetically. Follower counts come from the
// same per-creator analytics used by the professional dashboard.
const searchAccounts = { creators: [] };

function srAccountRow(c) {
  const handle = escapeHtml(c.handle || String(c.id).slice(0, 8));
  const avatar = c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="${handle} avatar" loading="lazy">` : `<span class="badge" aria-hidden="true"><i>${escapeHtml(handle[0]?.toUpperCase() || 'G')}</i></span>`;
  const bolt = c.verified ? verifiedBolt('verified-bolt-inline') : '';
  const followers = Number(c.followers) || 0;
  const meta = followers > 0 ? `${fmtCount(followers)} followers` : 'No followers yet';
  return `<a class="sr-acct" href="user.html?id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.handle || '')}"><span class="sr-avatar">${avatar}</span><span class="sr-info"><span class="sr-name">${handle}${bolt}</span><span class="sr-meta">${meta}</span></span></a>`;
}

// Shared renderer, also driven by the search input in search.html. Empty
// query: every account ranked by followers. Non-empty query: matches only,
// sorted alphabetically by display name.
window.renderSearchAccounts = function renderSearchAccounts(query) {
  const list = document.getElementById('sr-accounts');
  if (!list) return;
  const q = String(query || '').trim().toLowerCase();
  const nameOf = (c) => (c.handle || String(c.id).slice(0, 8)).toLowerCase();
  let rows = searchAccounts.creators;
  if (q) {
    rows = rows.filter((c) => nameOf(c).includes(q));
    rows = rows.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }));
  }
  if (!rows.length) {
    list.innerHTML = q
      ? `<div class="sr-empty"><span class="sr-empty-mark">⌕</span><h3>No accounts found</h3><p>No one matches “${escapeHtml(q)}” yet.</p></div>`
      : '<div class="sr-empty"><span class="sr-empty-mark">⌕</span><h3>No accounts yet</h3><p>Accounts that post on GlitchIt will show up here.</p></div>';
    return;
  }
  list.innerHTML = rows.map(srAccountRow).join('');
};

async function hydrateSearchAccounts() {
  const list = document.getElementById('sr-accounts');
  if (!list) return;
  let creators = [];
  // Prefer the real account registry — every registered user with their actual
  // username — via the serverless endpoint (it uses the Supabase Admin API;
  // the browser anon key cannot read auth.users). Falls back to the
  // media-derived creator list when the endpoint is unavailable.
  try {
    const res = await fetch('/api/accounts', { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (data && data.ok && Array.isArray(data.accounts) && data.accounts.length) {
      creators = data.accounts.map((a) => ({
        id: a.id,
        handle: a.username || '',
        avatar: a.avatar || '',
        verified: false,
      }));
    }
  } catch (err) { /* registry unavailable — fall through to media-derived */ }
  if (!creators.length) creators = DB ? await DB.loadCreators(30) : [];
  searchAccounts.creators = creators.map((c) => ({
    id: c.id,
    handle: c.handle || '',
    avatar: c.avatar || '',
    verified: Boolean(c.verified),
    followers: readProfileStats(c.id).followers,
  })).sort((a, b) => b.followers - a.followers);
  // Re-apply whatever is currently in the search box (the inline script may
  // have fired before the accounts finished loading).
  const box = document.getElementById('sr-query');
  window.renderSearchAccounts(box ? box.value : '');
}

// ---------- Outside profile view (user.html?id=...) ----------
// Public profile of another creator: avatar, handle, follower / following /
// post counts, a persistent Follow/Following toggle, and their media grid.
// Viewing your own id redirects to the own-profile page.
async function hydrateUserPage() {
  const params = new URLSearchParams(location.search);
  const targetId = String(params.get('id') || '').trim();
  const nameParam = String(params.get('name') || '').trim();
  const me = window.GLITCHIT_USER;
  if (!targetId || (me && !me.guest && targetId === me.id)) {
    location.replace('profile.html');
    return;
  }
  document.getElementById('user-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = 'search.html';
  });

  const topName = document.getElementById('user-top-name');
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  const postsEl = document.querySelector('[data-u-stat="posts"]');
  const followersEl = document.querySelector('[data-u-stat="followers"]');
  const followingEl = document.querySelector('[data-u-stat="following"]');
  const btn = document.getElementById('user-follow-btn');
  const grid = document.getElementById('user-grid');

  const rows = DB ? await DB.loadOwnMedia(targetId, 100) : [];
  const avatar = (rows.find((r) => r.avatar) || {}).avatar || '';
  const verified = Boolean(rows.find((r) => r.verified)?.verified);
  const posts = rows.filter((r) => r.kind !== 'video');
  const reels = rows.filter((r) => r.kind === 'video');
  const stats = readProfileStats(targetId);
  // Prefer the username the search page linked us with (real registry name),
  // then fall back to the short-id display used for media-derived accounts.
  const handle = nameParam || String(targetId).slice(0, 8);
  const esc = escapeHtml(handle);

  if (topName) topName.textContent = handle;
  if (nameEl) nameEl.innerHTML = `${esc}${verified ? verifiedBolt('verified-bolt-inline') : ''}`;
  if (avatarEl) { avatarEl.src = avatar || fallbackAvatar(handle); avatarEl.alt = `${handle} profile picture`; }
  if (postsEl) postsEl.textContent = String(posts.length);
  if (followersEl) followersEl.textContent = fmtCount(stats.followers);
  if (followingEl) followingEl.textContent = fmtCount(stats.following);
  const countPosts = document.getElementById('user-count-posts');
  const countReels = document.getElementById('user-count-reels');
  if (countPosts) countPosts.textContent = String(posts.length);
  if (countReels) countReels.textContent = String(reels.length);

  const renderBtn = () => {
    if (!btn) return;
    const on = isFollowing(targetId);
    btn.textContent = on ? 'Following' : 'Follow';
    btn.classList.toggle('following', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  renderBtn();
  if (btn) {
    btn.addEventListener('click', () => {
      setFollowing(targetId, !isFollowing(targetId));
      renderBtn();
      if (followersEl) followersEl.textContent = fmtCount(readProfileStats(targetId).followers);
      showEndToast(isFollowing(targetId) ? `You're now following @${handle}` : `You unfollowed @${handle}`);
    });
  }

  const renderGrid = (label) => {
    if (!grid) return;
    const isReel = label === 'reels';
    const items = isReel ? reels : posts;
    if (!items.length) {
      grid.innerHTML = `<p class="profile-empty">${isReel ? 'No reels yet.' : 'No posts yet.'}</p>`;
      return;
    }
    grid.innerHTML = items.map((r) => profileTile(r, isReel)).join('');
    // Outside viewers never see delete controls.
    grid.querySelectorAll('.profile-tile-delete').forEach((b) => b.remove());
  };
  const tabs = document.querySelectorAll('.profile-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      renderGrid((tab.getAttribute('aria-label') || 'posts').toLowerCase());
    });
  });
  renderGrid('posts');
}

// ---------- Profile media (grouped Posts / Reels, owner-deletable) ----------
let profileMedia = { posts: [], reels: [], loaded: false, loading: false };

function profileEmpty(label) {
  if (label === 'reels') return '<p class="profile-empty">No reels yet — record your first reel from the camera.</p>';
  if (label === 'tagged') return '<p class="profile-empty">No tagged posts yet.</p>';
  return '<p class="profile-empty">No posts yet — share your first moment.</p>';
}

function profileTile(r, isReel) {
  const src = isReel ? (r.poster || r.url) : r.url;
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(r.title || (isReel ? 'Reel' : 'Post'))}" loading="lazy">`;
  const play = isReel ? '<span class="profile-tile-play" aria-hidden="true">▶</span>' : '';
  return `<div class="profile-tile" data-media-id="${r.id}">${img}${play}<button type="button" class="profile-tile-delete" data-delete-id="${r.id}" aria-label="Delete ${escapeHtml(r.title || 'this post')}">🗑</button></div>`;
}

function updateProfileCounts() {
  const total = profileMedia.posts.length + profileMedia.reels.length;
  const postsStat = document.querySelector('[data-stat="posts"]');
  if (postsStat) postsStat.textContent = String(total);
  const pc = document.getElementById('profile-count-posts');
  if (pc) pc.textContent = String(profileMedia.posts.length);
  const rc = document.getElementById('profile-count-reels');
  if (rc) rc.textContent = String(profileMedia.reels.length);
}

function showEndToast(text) {
  const tip = document.createElement('div');
  tip.className = 'end-toast show';
  tip.textContent = text;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2200);
}

function renderProfileTab(label) {
  const grid = document.querySelector('.profile-grid');
  if (!grid || label === 'saved') return;
  const user = window.GLITCHIT_USER;
  if (!user || user.guest) {
    grid.innerHTML = '<p class="profile-empty">Sign in to see and manage your posts & reels.</p>';
    return;
  }
  const isReel = label === 'reels';
  const rows = isReel ? profileMedia.reels : profileMedia.posts;
  if (!rows.length) { grid.innerHTML = profileEmpty(label); return; }
  grid.innerHTML = rows.map((r) => profileTile(r, isReel)).join('');
  grid.querySelectorAll('.profile-tile-delete').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteMedia(btn));
  });
}

async function confirmDeleteMedia(btn) {
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = 'Sure?';
    btn.setAttribute('aria-label', 'Confirm delete');
    setTimeout(() => {
      if (btn.classList.contains('confirm') && !btn.dataset.deleting) {
        btn.classList.remove('confirm');
        btn.textContent = '🗑';
      }
    }, 3000);
    return;
  }
  const id = btn.dataset.deleteId;
  const tile = btn.closest('.profile-tile');
  btn.dataset.deleting = '1';
  btn.disabled = true;
  const res = DB ? await DB.deleteMedia(id) : { ok: false };
  if (res.ok) {
    if (tile) tile.remove();
    profileMedia.posts = profileMedia.posts.filter((r) => String(r.id) !== String(id));
    profileMedia.reels = profileMedia.reels.filter((r) => String(r.id) !== String(id));
    updateProfileCounts();
    const grid = document.querySelector('.profile-grid');
    if (grid && !grid.querySelector('.profile-tile')) {
      const active = document.querySelector('.profile-tab.active');
      renderProfileTab((active && active.getAttribute('aria-label') || 'posts').toLowerCase());
    }
    showEndToast('Deleted');
  } else {
    btn.classList.remove('confirm');
    btn.dataset.deleting = '';
    btn.disabled = false;
    btn.textContent = '🗑';
    showEndToast(res.reason === 'permission'
      ? 'Delete blocked by Supabase (RLS) — allow deletes on the media table.'
      : 'Couldn’t delete — try again.');
  }
}

// Profile page: fill the grouped Posts/Reels grid with the signed-in user's real media.
async function hydrateProfileGrid() {
  const grid = document.querySelector('.profile-grid');
  const user = window.GLITCHIT_USER;
  if (!grid || profileMedia.loading) return;
  if (!user || user.guest) {
    grid.innerHTML = '<p class="profile-empty">Sign in to see and manage your posts & reels.</p>';
    return;
  }
  profileMedia.loading = true;
  try {
    const rows = DB ? await DB.loadOwnMedia(user.id, 100) : [];
    profileMedia.posts = rows.filter((r) => r.kind !== 'video');
    profileMedia.reels = rows.filter((r) => r.kind === 'video');
    profileMedia.loaded = true;
    updateProfileCounts();
    const active = document.querySelector('.profile-tab.active');
    renderProfileTab(active ? (active.getAttribute('aria-label') || 'posts').toLowerCase() : 'posts');
  } finally {
    profileMedia.loading = false;
  }
}

// ---------- Shop page: real creators + real media + your storefront ----------
// Every shop section is filled from the database (creators derived from the
// media table, shop glitches from real videos, storefront from the signed-in
// user). When there is no data yet, each section shows an empty state — no
// fake accounts are ever rendered.
async function hydrateShop() {
  hydrateShopStories();
  hydrateShopGlitches();
  hydrateShopProfile();
}

async function hydrateShopStories() {
  const shelf = document.getElementById('shop-stories');
  if (!shelf) return;
  const creators = DB ? await DB.loadCreators(6) : [];
  if (!creators.length) {
    shelf.innerHTML = '<p class="profile-empty">No seller stories yet — creators who post will show up here.</p>';
    return;
  }
  shelf.innerHTML = creators.map((c) => {
    const handle = escapeHtml(c.handle || String(c.id).slice(0, 8));
    const avatar = c.avatar ? escapeHtml(c.avatar) : fallbackAvatar(handle);
    const bolt = c.verified ? verifiedBolt('verified-bolt-inline') : '';
    return `<a class="story" href="#" data-story-name="${handle}" data-story-image="${avatar}" data-story-live="false" aria-label="Open ${handle}'s story"><span class="story-ring"><img src="${avatar}" alt="${handle} avatar" loading="lazy"></span><span>${handle}${bolt}</span></a>`;
  }).join('');
  attachStoryLinks();
}

async function hydrateShopGlitches() {
  const reel = document.getElementById('glitches-reel');
  if (!reel) return;
  const rows = DB ? await DB.loadMedia('video', 12) : [];
  if (!rows.length) {
    reel.innerHTML = '<div class="feed-empty"><span class="feed-empty-mark">▣</span><h3>No shop glitches yet</h3><p>Videos shared by creators will appear here.</p></div>';
    return;
  }
  reel.innerHTML = rows.map((r) => glitchVideoCard({ id: r.id, title: r.title, caption: r.caption, src: r.url, poster: r.poster || r.url, user: displayUser(r.user), avatar: r.avatar, verified: r.verified, owner: r.user, likes: String(r.likes || 0), comments: String(r.comments || 0), shares: String(r.shares || 0) })).join('');
  attachReelsActions();
  attachGlitchAutoplay();
}

async function hydrateShopProfile() {
  const panel = document.querySelector('[data-shop-panel="profile"]');
  if (!panel) return;
  const user = window.GLITCHIT_USER;
  const nameEl = document.getElementById('store-name');
  const handleEl = document.getElementById('store-handle');
  const avatar = panel.querySelector('.store-avatar');
  const products = panel.querySelector('[data-stat="store-products"]');
  const drops = panel.querySelector('[data-stat="store-drops"]');
  const grid = document.getElementById('store-grid');
  if (!user || user.guest) {
    if (nameEl) nameEl.textContent = 'Your store';
    if (handleEl) handleEl.textContent = '@you';
    if (avatar) avatar.src = fallbackAvatar('you');
    if (products) products.textContent = '0';
    if (drops) drops.textContent = '0';
    if (grid) grid.innerHTML = '<p class="profile-empty">Sign in to open your storefront — your drops will appear here.</p>';
    return;
  }
  const handle = user.user_metadata?.username || user.email?.split('@')[0] || 'you';
  if (nameEl) nameEl.textContent = handle;
  if (handleEl) handleEl.textContent = `@${handle}`;
  if (avatar) avatar.src = profile.avatar;
  const count = DB ? await DB.countMedia(user.id) : 0;
  if (products) products.textContent = String(count);
  if (drops) drops.textContent = String(count);
  const rows = DB ? await DB.loadMedia('image') : [];
  const mine = rows.filter((r) => r.user === user.id);
  if (!mine.length) {
    if (grid) grid.innerHTML = '<p class="profile-empty">No drops yet — share your first post and it will appear here.</p>';
    return;
  }
  if (grid) {
    grid.innerHTML = mine.slice(0, 12).map((r) => `<article class="store-card"><img src="${escapeHtml(r.url)}" alt="${escapeHtml(r.title || 'Drop')}" loading="lazy"><div><span>Post</span><h3>${escapeHtml(r.title || 'Untitled')}</h3><p>${escapeHtml(r.caption || '')}</p></div></article>`).join('');
  }
}

const page = document.body.dataset.page || 'home';

// ---------- Bottom bar auto-dismiss ----------
// Fades the floating pill bar out when the user reaches the very bottom of a
// page (so the content and the "you're all caught up" toast breathe), and fades
// it back in the moment they scroll back up. Runs on every page: the
// capture-phase listener catches window AND inner-container scrolling.
(function attachBottomBarDismiss() {
  const bar = document.querySelector('.bottom-bar');
  if (!bar) return;
  const desktop = window.matchMedia('(min-width: 761px)'); // desktop hides the bar anyway
  const apply = (hiddenNow) => bar.classList.toggle('bottom-bar-hidden', hiddenNow);
  const nearBottom = (el) => {
    let scrollTop, scrollHeight, clientHeight;
    if (!el || el === document || el === document.documentElement || el === document.body || el === window) {
      scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight || 0);
      clientHeight = window.innerHeight;
    } else {
      scrollTop = el.scrollTop || 0;
      scrollHeight = el.scrollHeight || 0;
      clientHeight = el.clientHeight || 0;
    }
    // Only hide once the page actually scrolls and the user is at the extreme
    // bottom (last ~32px); a barely-scrollable page never hides the bar.
    return scrollHeight > clientHeight + 1 && scrollTop > 4 && scrollTop + clientHeight >= scrollHeight - 32;
  };
  const onScroll = (event) => {
    if (desktop.matches) return;
    const target = event.target;
    apply(nearBottom(target && typeof target.scrollTop === 'number' ? target : document));
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', () => { if (!desktop.matches) apply(nearBottom(document)); }, { passive: true });
  if (!desktop.matches) apply(nearBottom(document)); // restore-scroll safety
})();

function returnToPage() {
  try { return new URLSearchParams(location.search).get('returnTo') || ''; } catch (e) { return ''; }
}

// ---------- Supabase database (optional — see src/config.js) ----------
// Loaded lazily so the app works identically when no keys are configured.
let DB = null;
import('./db.js?v=5').then((mod) => { DB = mod; }).catch((err) => { DB = null; if (window.GLITCHIT_REPORT) window.GLITCHIT_REPORT(err, { phase: 'db-load' }); });

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
  if (isVideo) return glitchVideoCard({ ...item, user: profile.username, avatar: profile.avatar, verified: item.verified, owner: item.owner, src: item.src || item.preview, poster: item.preview, caption: item.caption || item.title }, true);
  const isBolt = Boolean(item.verified || meVerified);
  const bolt = isBolt ? verifiedBolt('verified-bolt-inline') : '';
  return `<article class="post upload-card"><header><div class="profile"><span class="verified-avatar-wrap"><img src="${profile.avatar}" alt="${profile.username} avatar">${isBolt ? verifiedBolt() : ''}</span><div><strong>${profile.username}${bolt}</strong><span>Fresh post</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${item.preview}" alt="${item.title}" loading="lazy" decoding="async"><span class="shop-badge">${icon('＋')} ${item.type}</span></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>New upload</strong><p><b>${profile.username}${bolt}</b> ${item.caption || item.title}</p></article>`;
}

function glitchVideoCard(video, uploaded = false) {
  const likes = video.likes || '0';
  const comments = video.comments || '0';
  const shares = video.shares || '0';
  const replyTo = video.replyTo || video.user;
  const savedClass = video.saved ? ' saved' : '';
  const verified = Boolean(video.verified || (uploaded && meVerified));
  const nameBolt = verified ? verifiedBolt('verified-bolt-inline') : '';
  const avatarBolt = verified ? verifiedBolt() : '';
  return `<article class="video-card reel-card ${uploaded ? 'upload-card' : ''}" data-owner="${video.owner || ''}"><video class="glitch-video" playsinline loop preload="metadata" poster="${video.poster || ''}" src="${video.src}" aria-label="${video.title}"></video><button type="button" class="video-toggle" aria-label="Pause ${video.title}">${icon('Ⅱ')}</button><button type="button" class="sound-toggle" aria-label="Mute ${video.title}">${icon('🔊')}</button><div class="reel-rail"><button type="button" class="reel-action reel-like" aria-label="Like, ${likes} likes">${reelIcon('heart')}<b>${likes}</b></button><button type="button" class="reel-action" aria-label="Comment, ${comments} comments">${reelIcon('comment')}<b>${comments}</b></button><button type="button" class="reel-action" aria-label="Share, ${shares} shares">${reelIcon('send')}<b>${shares}</b></button><span class="reel-disc" aria-hidden="true"><i>♪</i></span><button type="button" class="reel-action reel-save${savedClass}" data-video-id="${video.id || ''}" aria-label="${video.saved ? 'Unsave' : 'Save'} ${video.title}">${reelIcon('bookmark')}</button></div><div class="video-overlay reel-overlay"><div class="reel-creator"><span class="verified-avatar-wrap"><img src="${video.avatar}" alt="${video.user} avatar">${avatarBolt}</span><div class="reel-meta"><strong>${video.user}${nameBolt}</strong><p>${video.caption}</p></div><button type="button" class="reel-follow">Follow</button></div><div class="reel-comment"><span>Reply to ${replyTo}'s Like…</span><span class="reel-emojis" aria-hidden="true"><i>😂</i><i>🔥</i><i>😍</i><b>♥</b></span></div></div></article>`;
}

function renderUploads(type) {
  return userUploads[type].map((item) => uploadCard(item, type)).join('');
}

// ---------- Stories ----------
function attachStoryLinks() {
  document.querySelectorAll('.story[data-story-name], .story[data-story-list]').forEach((storyLink) => {
    if (storyLink.dataset.storyReady) return;
    storyLink.dataset.storyReady = 'true';
    storyLink.addEventListener('click', (event) => {
      event.preventDefault();
      let stories = null;
      if (storyLink.dataset.storyList) {
        try { stories = JSON.parse(storyLink.dataset.storyList); } catch (e) { stories = null; }
      }
      if (!stories || !stories.length) {
        stories = [{
          name: storyLink.dataset.storyName,
          image: storyLink.dataset.storyImage,
          live: storyLink.dataset.storyLive === 'true',
          own: storyLink.dataset.storyOwn === 'true',
          reveal: storyLink.dataset.storyReveal === 'true',
          key: storyLink.dataset.storyKey || '',
        }];
      }
      openStoryViewer(stories);
    });
  });
  if (!document.body.dataset.storyDismissReady) {
    document.body.dataset.storyDismissReady = 'true';
    document.addEventListener('click', (event) => {
      if (event.target.matches('.story-viewer, .story-close, .sv-backdrop')) document.getElementById('story-viewer')?.remove();
    });
  }
}

// Frames-style story viewer: full-screen with a segmented progress bar, a
// tilted polaroid, and — only when the creator picked the effect — a fogged
// photo that reveals on shake (device motion on phones; tap the pill anywhere
// else). Plays every story from the same creator in sequence: when a segment's
// loading bar finishes it auto-advances to their next story, then closes.
function openStoryViewer(stories) {
  if (!stories || !stories.length) return;
  document.getElementById('story-viewer')?.remove();

  const STORY_MS = 8000;
  let index = 0;
  let revealed = false;
  let autoTimer = null;
  let lastMag = null;

  const current = () => stories[index] || {};
  const segHtml = stories.map(() => '<i></i>').join('');
  const ownStory = stories.some((s) => s.own);
  const moreMenu = ownStory
    ? `<span class="sv-more-wrap"><button type="button" class="sv-more" aria-label="Story options" aria-expanded="false">⋯</button><span class="sv-menu" hidden><button type="button" data-story-delete>Delete story</button></span></span>`
    : `<span class="sv-more-wrap"><button type="button" class="sv-more" aria-label="Story options" aria-expanded="false">⋯</button><span class="sv-menu" hidden><button type="button" data-story-report>Report</button></span></span>`;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="story-viewer" id="story-viewer" role="dialog" aria-modal="true" aria-label="${escapeHtml(stories[0].name)} story">
      <div class="sv-progress" aria-hidden="true">${segHtml}</div>
      <div class="sv-backdrop" aria-hidden="true"></div>
      <header class="sv-head">
        <a class="sv-id" href="profile.html">
          <span class="sv-avatar"><img alt=""></span>
          <span class="sv-id-meta"><strong></strong><span class="sv-time-wrap"></span></span>
        </a>
        <span class="sv-frames"><i aria-hidden="true">✦</i>Frames by GlitchIt</span>
        <span class="sv-actions">${moreMenu}<button type="button" class="story-close" aria-label="Close story">✕</button></span>
      </header>
      <main class="sv-stage">
        <figure class="sv-polaroid">
          <div class="sv-photo"><span class="sv-fog" aria-hidden="true">✦</span><img alt=""></div>
          <figcaption class="sv-caption"><strong></strong><span></span></figcaption>
        </figure>
        <button type="button" class="sv-shake"><i aria-hidden="true">⚡</i>Shake to reveal</button>
      </main>
      <footer class="sv-bar">
        <form class="sv-msg" data-sv-msg><input type="text" placeholder="Send message" aria-label="Send message" autocomplete="off"></form>
        <button type="button" class="sv-like" aria-label="Like this story">♥</button>
        <button type="button" class="sv-share" aria-label="Share this story"><i aria-hidden="true">➤</i></button>
      </footer>
    </div>`);

  const viewer = document.getElementById('story-viewer');
  const polaroid = viewer.querySelector('.sv-polaroid');
  const shakeBtn = viewer.querySelector('.sv-shake');
  const segments = [...viewer.querySelectorAll('.sv-progress i')];

  // Render the story at `index`: polaroid photo, header, and the reveal state.
  function renderStory() {
    const s = current();
    if (!s.name && !s.image) return;
    const now = new Date();
    const dateLine = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
      + ' • ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const timeLine = s.live
      ? '<i class="sv-live-pill">LIVE</i>'
      : '<span class="sv-time">now</span>';
    viewer.querySelector('.sv-backdrop').style.backgroundImage = `url('${s.image}')`;
    viewer.querySelector('.sv-avatar img').src = s.image;
    viewer.querySelector('.sv-id-meta strong').textContent = s.name;
    viewer.querySelector('.sv-id-meta .sv-time-wrap').innerHTML = timeLine;
    viewer.querySelector('.sv-photo img').src = s.image;
    viewer.querySelector('.sv-photo img').alt = `${s.name} story`;
    viewer.querySelector('.sv-caption strong').textContent = s.name;
    viewer.querySelector('.sv-caption span').textContent = dateLine;
    // Segmented progress: finished segments stay full, the active one animates
    // only while its loading bar is actually running (reveal stories hold until
    // the polaroid is revealed).
    segments.forEach((seg, i) => {
      seg.classList.toggle('done', i < index);
      seg.classList.toggle('active', false);
    });
    // Shake-to-reveal is an opt-in effect the creator chose on the camera page.
    revealed = false;
    polaroid.classList.remove('revealed');
    if (s.reveal) {
      polaroid.classList.add('reveal-mode');
      shakeBtn.hidden = false;
      shakeBtn.innerHTML = '<i aria-hidden="true">⚡</i>Shake to reveal';
      shakeBtn.classList.remove('done');
      stopTimer(); // hold until revealed
    } else {
      polaroid.classList.remove('reveal-mode');
      shakeBtn.hidden = true;
      startTimer();
    }
  }

  function stopTimer() { clearTimeout(autoTimer); autoTimer = null; }
  function startTimer() {
    stopTimer();
    const seg = segments[index];
    if (seg) seg.classList.add('active');
    autoTimer = setTimeout(() => {
      // Loading bar finished → switch to the next story by the same creator.
      if (index + 1 < stories.length) {
        index += 1;
        renderStory();
      } else {
        viewer.remove();
      }
    }, STORY_MS);
  }

  // Reveal the polaroid photo (once) — only meaningful when the effect is on.
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    polaroid.classList.add('revealed');
    shakeBtn.innerHTML = '<i aria-hidden="true">✓</i>Revealed';
    shakeBtn.classList.add('done');
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) { /* ignore */ } }
    startTimer(); // revealed → let the loading bar finish and advance
  };
  shakeBtn.addEventListener('click', reveal);

  // Shake detection: a sharp jump in device motion reveals the photo. iOS 13+
  // asks for permission first, so tap-to-reveal is always the fallback.
  const onMotion = (e) => {
    const s = current();
    if (!s.reveal || revealed) return;
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
    if (lastMag !== null && mag - lastMag > 14) reveal();
    lastMag = mag;
  };
  if (window.DeviceMotionEvent && typeof window.DeviceMotionEvent.requestPermission === 'function') {
    window.DeviceMotionEvent.requestPermission().then((res) => {
      if (res === 'granted') window.addEventListener('devicemotion', onMotion);
    }).catch(() => { /* permission denied — tap to reveal still works */ });
  } else {
    window.addEventListener('devicemotion', onMotion);
  }

  const moreBtn = viewer.querySelector('.sv-more');
  if (moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = moreBtn.parentElement.querySelector('.sv-menu');
      const open = menu.hidden;
      menu.hidden = !open;
      moreBtn.setAttribute('aria-expanded', String(open));
    });
  }
  viewer.querySelector('[data-story-delete]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isGuest()) { showGuestGate('Sign in to manage your story'); return; }
    const s = current();
    if (!window.confirm('Delete this story?')) return;
    stopTimer();
    if (s.key && s.key.startsWith('mine:')) {
      // Remove exactly this story from the creator's story list.
      const at = Number(s.key.slice(5));
      let mine = [];
      try { mine = JSON.parse(localStorage.getItem(STORY_MINE_KEY) || '[]'); } catch (err) { mine = []; }
      mine = mine.filter((m) => m.at !== at);
      try { localStorage.setItem(STORY_MINE_KEY, JSON.stringify(mine)); } catch (err) { /* ignore */ }
      if (mine.length) {
        try { localStorage.setItem(STORY_LATEST_KEY, JSON.stringify(mine[0])); } catch (err) { /* ignore */ }
      } else {
        clearStoryLatest();
      }
    } else {
      userUploads.stories.shift();
      saveUploads();
      clearStoryLatest();
    }
    stories.splice(index, 1);
    if (!stories.length) { viewer.remove(); }
    else {
      if (index >= stories.length) index = stories.length - 1;
      renderStory();
    }
    hydrateStoryShelf();
  });
  viewer.querySelector('[data-story-report]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopTimer();
    viewer.remove();
    glitchToast('Thanks — we’ll take a look at this story.');
  });

  const msgForm = viewer.querySelector('[data-sv-msg]');
  msgForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = msgForm.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    glitchToast(`Message sent to ${current().name}`);
  });
  viewer.querySelector('.sv-like')?.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.classList.toggle('on');
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* ignore */ } }
  });
  viewer.querySelector('.sv-share')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const share = e.currentTarget;
    share.classList.add('pop');
    setTimeout(() => share.classList.remove('pop'), 320);
  });

  renderStory();
  viewer.querySelector('.story-close')?.focus();
}

// The user's story records (mirrored from the story camera page): the newest
// single story (thumb for the "Your story" ring) plus the full per-user list
// so the viewer can auto-advance through every story they shared.
const STORY_LATEST_KEY = 'glitchit.story.latest';
const STORY_MINE_KEY = 'glitchit.story.mine';
function storyLatest() {
  try { return JSON.parse(localStorage.getItem(STORY_LATEST_KEY) || 'null'); } catch (e) { return null; }
}
function storyMine() {
  try {
    const list = JSON.parse(localStorage.getItem(STORY_MINE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function clearStoryLatest() {
  try { localStorage.removeItem(STORY_LATEST_KEY); } catch (e) { /* ignore */ }
}

// Encode a list of story items for a `data-story-list` attribute (JSON).
function storyListAttr(stories) {
  return escapeHtml(JSON.stringify(stories));
}

function hydrateStoryShelf() {
  const shelf = document.querySelector('.stories');
  if (!shelf) return;
  shelf.querySelectorAll('.story[data-story-dynamic="true"]').forEach((link) => link.remove());
  // Entry ring for the story camera: the "Your story" ring shows the latest
  // shared story (or your avatar) and plays every story you've shared in
  // sequence. Creating happens from the create tab on the right edge of the
  // home page (see index.html).
  const mine = storyMine();
  const latest = mine[0] || storyLatest();
  const avatar = profile.avatar || fallbackAvatar(profile.username || 'You');
  let selfRing;
  if (mine.length) {
    const list = mine.map((m) => ({
      name: 'Your story',
      image: m.poster || m.url,
      live: false,
      own: true,
      reveal: Boolean(m.reveal),
      key: 'mine:' + m.at,
    }));
    const thumb = list[0].image;
    selfRing = `<a class="story story-self" data-story-dynamic="true" data-story-list='${storyListAttr(list)}' aria-label="View your stories"><span class="story-ring live"><img src="${thumb}" alt="Your story">${mine.length > 1 ? `<i class="story-count" aria-hidden="true">${mine.length}</i>` : ''}</span><span>Your story</span></a>`;
  } else if (latest) {
    selfRing = `<a class="story story-self" data-story-dynamic="true" data-story-list='${storyListAttr([{ name: 'Your story', image: latest.poster || latest.url, live: false, own: true, reveal: Boolean(latest.reveal), key: 'mine:' + latest.at }])}' aria-label="View your story"><span class="story-ring live"><img src="${latest.poster || latest.url}" alt="Your story"></span><span>Your story</span></a>`;
  } else {
    selfRing = `<a class="story story-self" data-story-dynamic="true" href="camera.html" aria-label="Create a story"><span class="story-ring live"><img src="${avatar}" alt="You"><i class="story-self-badge" aria-hidden="true">＋</i></span><span>Your story</span></a>`;
  }
  shelf.insertAdjacentHTML('afterbegin', selfRing);
  // Group every story by its creator so one ring plays all of that user's
  // stories back-to-back (each story is a segment in the viewer's loading bar).
  const byCreator = new Map();
  [...userUploads.stories].reverse().forEach((story) => {
    const title = story.title || 'Someone';
    if (!byCreator.has(title)) byCreator.set(title, []);
    byCreator.get(title).push(story);
  });
  byCreator.forEach((list, title) => {
    const items = list.map((s) => ({ name: title, image: s.preview, live: true, own: false, reveal: false }));
    const link = document.createElement('a');
    link.className = 'story';
    link.href = '#';
    link.dataset.storyDynamic = 'true';
    link.dataset.storyList = JSON.stringify(items);
    link.setAttribute('aria-label', `Open ${title}'s stories`);
    link.innerHTML = `<span class="story-ring live"><img src="${list[0].preview}" alt="${escapeHtml(title)} avatar">${list.length > 1 ? `<i class="story-count" aria-hidden="true">${list.length}</i>` : ''}</span><span>${escapeHtml(title)}</span>`;
    shelf.appendChild(link);
  });
  attachStoryLinks();
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

function pauseGlitchVideo(video, byScroll = false) {
  const owner = video.closest('.video-card')?.dataset.owner;
  if (owner && video.dataset.lastTs) {
    recordWatch(owner, (Date.now() - Number(video.dataset.lastTs)) / 1000);
    video.dataset.lastTs = '';
  }
  video.pause();
  if (byScroll) video.dataset.scrollPaused = 'true';
  const card = video.closest('.video-card');
  card?.querySelector('.video-toggle')?.replaceChildren(document.createRange().createContextualFragment(icon('▶')));
}

function playGlitchVideo(video) {
  if (video.dataset.userPaused === 'true') return;
  // Track engagement for the professional dashboard (views + watch hours).
  const owner = video.closest('.video-card')?.dataset.owner;
  if (owner && !video.dataset.viewCounted) { video.dataset.viewCounted = '1'; recordView(owner); }
  video.dataset.lastTs = String(Date.now());
  getGlitchVideos().forEach((otherVideo) => {
    if (otherVideo !== video) pauseGlitchVideo(otherVideo, true);
  });
  // Auto replay: when a video becomes the active one again after scrolling away,
  // restart it from the top instead of resuming where it left off.
  if (video.paused && video.dataset.scrollPaused === 'true') video.currentTime = 0;
  video.dataset.scrollPaused = '';
  video.play().catch(() => pauseGlitchVideo(video));
  const card = video.closest('.video-card');
  card?.querySelector('.video-toggle')?.replaceChildren(document.createRange().createContextualFragment(icon('Ⅱ')));
}

function updateGlitchPlayback() {
  // Play whichever video is most visible in the viewport (any page that has
  // videos), pause the rest — and pause everything when none are visible.
  const mostVisible = getGlitchVideos().map((video) => {
    const rect = video.getBoundingClientRect();
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return { video, visible };
  }).filter(({ visible }) => visible > 0).sort((a, b) => b.visible - a.visible)[0]?.video;
  if (mostVisible) playGlitchVideo(mostVisible);
  else getGlitchVideos().forEach((v) => pauseGlitchVideo(v, true));
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
    const ownerId = btn.closest('.video-card')?.dataset.owner;
    const syncBtn = () => {
      const on = isFollowing(ownerId);
      btn.classList.toggle('following', on);
      btn.textContent = on ? 'Following' : 'Follow';
    };
    syncBtn();
    btn.addEventListener('click', () => {
      if (!ownerId) return;
      setFollowing(ownerId, !isFollowing(ownerId));
      syncBtn();
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
        user: card?.querySelector('.reel-meta strong')?.textContent || '',
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
      else if (label === 'posts' || label === 'reels' || label === 'tagged') {
        if (!profileMedia.loaded) await hydrateProfileGrid();
        renderProfileTab(label);
      }
    });
  });
}

// ---------- Page dispatch ----------
// Live viewing page: real viewer count, floating
// heart reactions, comment posting, and badge purchases.
function attachLive() {
  const chat = document.getElementById('live-chat');
  const hearts = document.getElementById('live-hearts');
  const viewers = document.getElementById('live-viewers');
  const form = document.getElementById('live-comment-form');
  const buyBtn = document.getElementById('live-buy');
  const heartBtn = document.getElementById('live-heart-btn');
  const player = document.getElementById('live-player');
  const liveUser = window.GLITCHIT_USER;
  if (liveUser && !liveUser.guest) {
    const hostName = document.getElementById('live-host-name');
    if (hostName) { const h = hostName.querySelector('.handle-text'); if (h) h.textContent = profile.username; }
    const hostImg = document.querySelector('.live-avatar');
    if (hostImg) hostImg.src = profile.avatar;
  }

  // ----- viewer count ticker -----
  let viewersCount = 1;
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

  // ----- chat (real messages only — posted by the signed-in viewer) -----
  const addMsg = (name, text) => {
    if (!chat) return;
    const row = document.createElement('div');
    row.className = 'live-msg';
    row.innerHTML = `<img src="${profile.avatar || fallbackAvatar(name)}" alt="" loading="lazy"><span><b>${escapeHtml(name)}</b> ${escapeHtml(text)}</span>`;
    chat.appendChild(row);
    while (chat.children.length > 4) chat.removeChild(chat.firstChild);
  };
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
    tip.innerHTML = `<span class="end-toast-mark">${icon('🏆')}</span><span class="end-toast-text">Badge purchased — thanks for supporting this stream!</span>`;
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
    const feedEmpty = () => {
      if (feedTarget && !feedTarget.children.length) {
        feedTarget.innerHTML = '<div class="feed-empty"><span class="feed-empty-mark">ϟ</span><h3>No posts yet</h3><p>Be the first to share a moment.</p></div>';
      }
    };
    if (DB) {
      DB.loadMedia('image').then((rows) => {
        if (!rows.length) { feedEmpty(); return; }
        if (!feedTarget) return;
        const cards = rows.map((r) => uploadCard({ preview: r.url, title: r.title, caption: r.caption, type: 'image', user: displayUser(r.user), avatar: r.avatar, verified: r.verified, owner: r.user }, 'feed')).join('');
        feedTarget.insertAdjacentHTML('afterbegin', cards);
      });
    } else {
      feedEmpty();
    }
    hydrateStoryShelf();
    attachNotes('home-notes');
  }
  if (page === 'glitches') {
    const videoTarget = document.getElementById('video-feed');
    if (videoTarget) videoTarget.innerHTML = renderUploads('videos');
    const glitchEmpty = () => {
      if (videoTarget && !videoTarget.children.length) {
        videoTarget.innerHTML = '<div class="feed-empty"><span class="feed-empty-mark">▣</span><h3>No glitches yet</h3><p>Share a reel and it will appear here for everyone.</p></div>';
      }
    };
    if (DB) {
      DB.loadMedia('video').then((rows) => {
        if (!rows.length) { glitchEmpty(); attachGlitchAutoplay(); attachReelsActions(); return; }
        if (!videoTarget) return;
        const cards = rows.map((r) => glitchVideoCard({ id: r.id, title: r.title, caption: r.caption, src: r.url, poster: r.poster || r.url, user: displayUser(r.user), avatar: r.avatar, verified: r.verified, owner: r.user, likes: String(r.likes || 0), comments: String(r.comments || 0), shares: String(r.shares || 0) })).join('');
        videoTarget.insertAdjacentHTML('afterbegin', cards);
        attachReelsActions();
        attachGlitchAutoplay();
      });
    } else {
      glitchEmpty();
    }
    attachGlitchAutoplay();
    attachReelsActions();
    markSavedReels();
  }
  if (page === 'live') attachLive();
  if (page === 'profile') {
    attachSettingsDrawer();
    attachProfileTabs();
    attachProfileAuth();
    attachProfessional();
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
  if (page === 'shop') { attachShopTabs(); attachShopFilters(); attachStoryLinks(); attachGlitchAutoplay(); attachShopGuards(); gateShop(); }

  if (page === 'search') hydrateSearchAccounts();
  if (page === 'user') hydrateUserPage();
  if (page === 'profile') hydrateProfileGrid();
  hydrateRail();
  // GlitchIt Verified: badge on the own avatar + backfill ⚡ onto existing posts.
  isVerifiedUser().then((verified) => {
    meVerified = verified;
    applyVerifiedBadges(verified);
    const user = window.GLITCHIT_USER;
    if (verified && DB && user && !user.guest) DB.updateMediaVerified(user.id, true).catch(() => {});
  });

  attachGuestGuards();
  window.addEventListener('scroll', updateGlitchPlayback, { passive: true });
}

// ---------- Supabase auth bootstrap ----------
const GUEST_KEY = 'glitchit.auth.guest.v1'; // guest browsing flag
const ACCOUNT_PAGES = ['messages', 'chat', 'profile', 'shop'];

// Interactions guests cannot perform on browsable pages.
const GUEST_GATED_SELECTOR = [
  '.reel-like', '.reel-follow', '.reel-save', '.reel-action',
  '.comment-box', '.text-button',
  '.post .actions',
  '.seller button',
  '.user-follow-btn',
  '.note-add',
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
    if (event.target.closest('.comment-box')) {
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
    import('./db.js?v=5').then((db) => db.setCurrentUser?.({ id: res.user.id, username: auth.userHandle(res.user) })).catch(() => {});
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
  // GlitchIt Pro status — reflects the RevenueCat entitlement in real time.
  const proStatus = document.getElementById('pro-status');
  if (proStatus) {
    const proRow = proStatus.closest('.settings-row');
    let proUser = false;
    let proToastTimer = null;
    const applyPro = (pro) => {
      proUser = Boolean(pro);
      proStatus.textContent = pro ? 'Active — thanks for supporting GlitchIt ✦' : 'Unlock premium features';
      proRow?.classList.toggle('pro-active', proUser);
    };
    const proToast = (message) => {
      let toast = document.getElementById('end-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'end-toast';
        toast.className = 'end-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
      }
      toast.innerHTML = `<span class="end-toast-mark">✦</span><span class="end-toast-text">${message}</span>`;
      toast.classList.remove('show');
      void toast.offsetWidth; // restart the animation
      toast.classList.add('show');
      clearTimeout(proToastTimer);
      proToastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
    };
    import('./revenuecat.js?v=5')
      .then((rc) => rc.isPro())
      .then(applyPro)
      .catch(() => { proStatus.textContent = 'Unavailable'; });
    // Tap the row to open RevenueCat's hosted paywall (requires a paywall
    // attached to the offering in the RevenueCat dashboard).
    proRow?.addEventListener('click', async () => {
      if (proUser) return;
      proStatus.textContent = 'Opening…';
      try {
        const rc = await import('./revenuecat.js?v=5');
        const result = await rc.presentPaywall();
        if (!result) { applyPro(false); return; }
        const pro = await rc.isPro();
        applyPro(pro);
        if (pro) proToast('Welcome to GlitchIt Pro ✦');
        else if (typeof rc.rcTestMode === 'function' && rc.rcTestMode()) proToast('Test mode: use a Stripe test card (4242 4242 4242 4242) — real cards are declined.');
        else proToast('Purchase not completed yet');
      } catch (err) {
        console.warn('GlitchIt: paywall failed', err);
        applyPro(false);
        const message = (err && err.message) || '';
        if (!/cancel/i.test(message)) {
          if (message.includes('paywall attached') || message.includes('No offering')) {
            proStatus.textContent = 'Setup needed';
            proToast('Pro isn’t ready yet — build & publish a paywall in RevenueCat → Paywalls.');
          } else {
            proToast('Couldn’t open the paywall — try again.');
          }
        }
      }
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
// ---------- Shop gate + professional dashboard (GlitchIt Verified) ----------
const PRO_MODE_KEY = 'glitchit.pro.mode';

function readProMode() {
  try { return localStorage.getItem(PRO_MODE_KEY) === '1'; } catch (e) { return false; }
}
function writeProMode(on) {
  try { localStorage.setItem(PRO_MODE_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}

// Branded toast that stays on the page (the guest-gate variant redirects).
function glitchToast(message) {
  const tip = document.createElement('div');
  tip.className = 'end-toast show';
  tip.setAttribute('role', 'status');
  tip.innerHTML = `<span class="end-toast-mark">${icon('⚡')}</span><span class="end-toast-text">${escapeHtml(message)}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2200);
}

// Opens RevenueCat's hosted paywall from any gate CTA, then refreshes gates.
async function openVerifiedPaywall() {
  try {
    const rc = await import('./revenuecat.js?v=5');
    const result = await rc.presentPaywall();
    if (!result) return;
    const pro = await rc.isPro();
    if (!pro) {
      const testHint = (typeof rc.rcTestMode === 'function' && rc.rcTestMode())
        ? 'Payment not verified — test mode only accepts Stripe test cards (4242 4242 4242 4242). Real cards are rejected until the production API key is in use.'
        : 'Payment not verified — please try again in a moment.';
      glitchToast(testHint);
      return;
    }
    meVerified = true;
    applyVerifiedBadges(true);
    const user = window.GLITCHIT_USER;
    if (user && !user.guest && DB) DB.updateMediaVerified(user.id, true).catch(() => {});
    glitchToast('Welcome to GlitchIt Verified ⚡');
    gateShop();
    writeProMode(true);
    const sheet = document.getElementById('prodash-sheet');
    const backdrop = document.getElementById('prodash-backdrop');
    if (sheet && backdrop && !sheet.hidden) {
      const stats = readProfileStats(user && !user.guest ? user.id : null);
      document.getElementById('prodash-body').innerHTML = proDashStatsHtml(stats);
    }
    const toggle = document.getElementById('pro-account-toggle');
    if (toggle && !toggle.checked) toggle.checked = true;
    const status = document.getElementById('pro-account-status');
    if (status) status.textContent = 'Professional mode is on — dashboard unlocked';
    document.querySelector('.pro-dashboard')?.classList.add('prodash-unlocked');
  } catch (err) {
    console.warn('GlitchIt: paywall failed', err);
    const message = (err && err.message) || '';
    if (!/cancel/i.test(message)) glitchToast('Couldn’t open the paywall — try again.');
  }
}

// Shop is Verified-only: show the gate card and hide the shop feed otherwise.
async function gateShop() {
  const gate = document.getElementById('shop-verified-gate');
  if (!gate) return;
  const user = window.GLITCHIT_USER;
  const verified = meVerified || await isVerifiedUser();
  const locked = !verified || Boolean(user && user.guest);
  gate.hidden = !locked;
  document.body.classList.toggle('shop-gated', locked);
  if (locked) {
    document.getElementById('shop-gate-cta')?.addEventListener('click', openVerifiedPaywall);
  }
}

// Belt-and-braces: block shop interactions for unverified users.
function attachShopGuards() {
  const user = window.GLITCHIT_USER;
  if (user && user.guest) return;
  isVerifiedUser().then((verified) => {
    if (verified || meVerified) return;
    const block = (e) => {
      e.preventDefault();
      e.stopPropagation();
      glitchToast('The Shop is for GlitchIt Verified members ⚡');
    };
    document.getElementById('list-product')?.addEventListener('submit', block);
    document.querySelectorAll('#list-product button[type="button"], .primary-action[href="#list-product"], .store-follow').forEach((el) => el.addEventListener('click', block));
  });
}

// Professional account: settings toggle + gated dashboard sheet.
function attachProfessional() {
  const link = document.querySelector('.pro-dashboard');
  const toggle = document.getElementById('pro-account-toggle');
  const status = document.getElementById('pro-account-status');
  const backdrop = document.getElementById('prodash-backdrop');
  const sheet = document.getElementById('prodash-sheet');
  const closeBtn = document.getElementById('prodash-close');

  if (toggle) toggle.checked = readProMode();

  toggle?.addEventListener('change', async () => {
    const on = toggle.checked;
    if (!on) {
      writeProMode(false);
      if (status) status.textContent = 'Switch to access creator earnings';
      link?.classList.remove('prodash-unlocked');
      return;
    }
    const verified = meVerified || await isVerifiedUser();
    if (!verified) {
      toggle.checked = false;
      openProDashGate();
      return;
    }
    writeProMode(true);
    if (status) status.textContent = 'Professional mode is on — dashboard unlocked';
    link?.classList.add('prodash-unlocked');
    glitchToast('Professional account switched on ⚡');
  });

  link?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!readProMode()) {
      glitchToast('Switch to a professional account in Settings → Access first');
      document.body.classList.add('settings-open');
      return;
    }
    openProDashSheet();
  });

  closeBtn?.addEventListener('click', closeProDashSheet);
  backdrop?.addEventListener('click', closeProDashSheet);

  if (link && readProMode()) {
    isVerifiedUser().then((verified) => {
      link.classList.toggle('prodash-unlocked', Boolean(verified));
      if (status) status.textContent = verified ? 'Professional mode is on — dashboard unlocked' : 'Switch to access creator earnings';
    });
  }
}

function openProDashGate() {
  const backdrop = document.getElementById('prodash-backdrop');
  const sheet = document.getElementById('prodash-sheet');
  if (!backdrop || !sheet) return;
  document.getElementById('prodash-body').innerHTML = proDashLockedHtml();
  document.getElementById('prodash-verify-cta')?.addEventListener('click', openVerifiedPaywall);
  backdrop.hidden = false;
  sheet.hidden = false;
}

function openProDashSheet() {
  const backdrop = document.getElementById('prodash-backdrop');
  const sheet = document.getElementById('prodash-sheet');
  if (!backdrop || !sheet) return;
  const user = window.GLITCHIT_USER;
  const body = document.getElementById('prodash-body');
  isVerifiedUser().then((verified) => {
    if (!verified) {
      body.innerHTML = proDashLockedHtml();
      document.getElementById('prodash-verify-cta')?.addEventListener('click', openVerifiedPaywall);
    } else {
      const stats = readProfileStats(user && !user.guest ? user.id : null);
      body.innerHTML = proDashStatsHtml(stats);
    }
    backdrop.hidden = false;
    sheet.hidden = false;
  });
}

function closeProDashSheet() {
  const backdrop = document.getElementById('prodash-backdrop');
  const sheet = document.getElementById('prodash-sheet');
  if (backdrop) backdrop.hidden = true;
  if (sheet) sheet.hidden = true;
}

function proDashLockedHtml() {
  return `
    <div class="prodash-locked">
      <span class="prodash-lock-mark" aria-hidden="true">⚡</span>
      <h3>Verification required</h3>
      <p>Your professional dashboard is locked. Become GlitchIt Verified to unlock earnings, analytics, and creator tools.</p>
      <button type="button" class="prodash-cta" id="prodash-verify-cta">Get GlitchIt Verified</button>
    </div>`;
}

function proDashStatsHtml(stats) {
  const qualified = stats.followers >= PRO_FOLLOWERS_MIN && stats.watchHours >= PRO_WATCH_HOURS_MIN && stats.views >= PRO_VIEWS_MIN;
  const pct = (v, max) => Math.min(100, Math.round((Number(v) / max) * 100));
  const row = (label, value, max, unit) => `
    <div class="prodash-stat">
      <div class="prodash-stat-head"><span>${label}</span><b>${fmtCount(value)}${unit}</b></div>
      <div class="prodash-bar"><i style="width:${pct(value, max)}%"></i></div>
      <em>Goal: ${fmtCount(max)}${unit}</em>
    </div>`;
  return `
    <div class="prodash-hero ${qualified ? 'qualified' : ''}">
      <span class="prodash-hero-mark" aria-hidden="true">${qualified ? '🏆' : '⚡'}</span>
      <div><h3>${qualified ? 'You’re eligible to earn on GlitchIt' : 'Keep creating to unlock earnings'}</h3>
      <p>${qualified ? 'All requirements met — monetization is unlocked.' : 'Reach 100K followers, 5,000 watch hours and 500K views to start earning from the app.'}</p></div>
    </div>
    <div class="prodash-stats">
      ${row('Followers', stats.followers, PRO_FOLLOWERS_MIN, '')}
      ${row('Watch hours', stats.watchHours, PRO_WATCH_HOURS_MIN, 'h')}
      ${row('Views', stats.views, PRO_VIEWS_MIN, '')}
    </div>
    <div class="prodash-checklist">
      <p class="${stats.followers >= PRO_FOLLOWERS_MIN ? 'met' : ''}"><i aria-hidden="true">${stats.followers >= PRO_FOLLOWERS_MIN ? '✓' : '○'}</i>100K followers <b>${fmtCount(stats.followers)}</b></p>
      <p class="${stats.watchHours >= PRO_WATCH_HOURS_MIN ? 'met' : ''}"><i aria-hidden="true">${stats.watchHours >= PRO_WATCH_HOURS_MIN ? '✓' : '○'}</i>5,000 watch hours <b>${fmtCount(stats.watchHours)}h</b></p>
      <p class="${stats.views >= PRO_VIEWS_MIN ? 'met' : ''}"><i aria-hidden="true">${stats.views >= PRO_VIEWS_MIN ? '✓' : '○'}</i>500K views <b>${fmtCount(stats.views)}</b></p>
    </div>`;
}

async function boot() {
  const isAuthPage = page === 'auth';
  let auth = null;
  try { auth = await import('./auth.js?v=3'); } catch (err) { auth = null; }
  window.GLITCHIT_AUTH = auth;
  let guest = false;
  try { guest = localStorage.getItem(GUEST_KEY) === '1'; } catch (err) { /* ignore */ }
  const dbReady = async () => {
    if (DB) return DB;
    try { return await import('./db.js?v=5'); } catch (err) { return null; }
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

  // Kick off RevenueCat (subscriptions) in the background — non-blocking, so
  // a missing key or CDN outage never affects the rest of the app. Uses the
  // signed-in account id when available, else a persisted anonymous id.
  import('./revenuecat.js?v=5')
    .then((rc) => rc.initRevenueCat(window.GLITCHIT_USER?.id))
    .catch(() => {});
}

boot();
