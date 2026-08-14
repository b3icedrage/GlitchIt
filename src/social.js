// GlitchIt — shared social layer: persisted likes, comments, an activity feed,
// and direct messages. Loaded from main.js via dynamic import (same pattern as
// db.js / auth.js). Everything is stored per-user in localStorage — the same
// style as follows, story reactions, and notes — so state survives navigation,
// re-renders, and refreshes without requiring new Supabase tables. Guests get
// read-only behavior; signed-in users get full persistence.

const LIKES_KEY = 'glitchit.social.likes.v1';
const COMMENTS_KEY = 'glitchit.social.comments.v1';
const ACTIVITY_KEY = 'glitchit.social.activity.v1';
const ACTIVITY_READ_KEY = 'glitchit.social.read.v1';
const DMS_KEY = 'glitchit.social.dms.v1';

// Current identity ({ id, username, avatar }) — guests stay anonymous so they
// never write anything into the per-user stores.
let me = { id: '', username: 'you', avatar: '', guest: true };

export function setSocialUser(user) {
  if (user && !user.guest && user.id) {
    me = { id: String(user.id), username: String(user.username || user.id.slice(0, 8)), avatar: String(user.avatar || ''), guest: false };
  } else {
    me = { id: '', username: 'you', avatar: '', guest: true };
  }
}

export function socialMe() {
  return me;
}

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value === null || value === undefined ? fallback : value;
  } catch (err) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage unavailable */ }
}

// "boxed" accessor: reads the whole store and returns { map, box } where box is
// the current user's slice (created on demand). Callers mutate box, then write
// the map back.
function boxed(key) {
  const map = read(key, {});
  if (!map[me.id]) map[me.id] = {};
  return { map, box: map[me.id] };
}

function stamp() {
  return Date.now();
}

// ---------------- Likes ----------------
export function toggleLike(mediaKey) {
  void 0;
  if (!mediaKey || me.guest) return false;
  const { map, box } = boxed(LIKES_KEY);
  const on = !box[mediaKey];
  if (on) box[mediaKey] = stamp();
  else delete box[mediaKey];
  write(LIKES_KEY, map);
  return on;
}

export function isLiked(mediaKey) {
  if (!mediaKey) return false;
  return Boolean((read(LIKES_KEY, {})[me.id] || {})[mediaKey]);
}

// How many local users (this device's accounts) liked this media.
export function localLikeCount(mediaKey) {
  if (!mediaKey) return 0;
  const map = read(LIKES_KEY, {});
  let n = 0;
  for (const uid in map) if (map[uid] && map[uid][mediaKey]) n += 1;
  return n;
}

// Base count comes from the media row (database); local delta adds on top.
export function totalLikes(mediaKey, baseCount) {
  return (Number(baseCount) || 0) + localLikeCount(mediaKey);
}

// ---------------- Comments ----------------
export function addComment(mediaKey, text) {
  if (!mediaKey || me.guest) return null;
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) return null;
  const { map, box } = boxed(COMMENTS_KEY);
  const list = box[mediaKey] || (box[mediaKey] = []);
  const comment = {
    id: 'c' + stamp() + Math.random().toString(36).slice(2, 6),
    text: clean,
    at: stamp(),
    username: me.username,
    avatar: me.avatar,
  };
  list.push(comment);
  if (list.length > 200) list.splice(0, list.length - 200);
  write(COMMENTS_KEY, map);
  return comment;
}

export function commentsFor(mediaKey) {
  if (!mediaKey) return [];
  return (read(COMMENTS_KEY, {})[me.id] || {})[mediaKey] || [];
}

export function totalComments(mediaKey, baseCount) {
  return (Number(baseCount) || 0) + commentsFor(mediaKey).length;
}

// ---------------- Activity feed ----------------
// Events are stored newest-first per user and rendered on activity.html.
// Each event: { type, actorName, mediaType, text?, href?, at }
export function pushActivity(event) {
  if (me.guest || !event || !event.type) return;
  const map = read(ACTIVITY_KEY, {});
  if (!Array.isArray(map[me.id])) map[me.id] = [];
  const list = map[me.id];
  list.unshift({ at: stamp(), actor: me.username, actorAvatar: me.avatar, ...event });
  if (list.length > 120) list.length = 120;
  write(ACTIVITY_KEY, map);
}

export function myActivity() {
  if (me.guest) return [];
  return read(ACTIVITY_KEY, {})[me.id] || [];
}

export function unreadActivity() {
  if (me.guest) return 0;
  const lastRead = Number((read(ACTIVITY_READ_KEY, {})[me.id] || 0));
  return myActivity().filter((e) => e.at > lastRead).length;
}

export function markActivityRead() {
  if (me.guest) return;
  const map = read(ACTIVITY_READ_KEY, {});
  map[me.id] = stamp();
  write(ACTIVITY_READ_KEY, map);
}

// ---------------- Direct messages ----------------
// dms[userId][partnerKey] = { partner: {id,name,avatar}, messages: [{id,from,text,at}] }
export function dmConversations() {
  if (me.guest) return [];
  const map = read(DMS_KEY, {})[me.id] || {};
  return Object.values(map)
    .filter((c) => c && Array.isArray(c.messages) && c.messages.length)
    .sort((a, b) => (lastMsgAt(b) - lastMsgAt(a)));
}

function lastMsgAt(conv) {
  const msgs = conv && conv.messages;
  return msgs && msgs.length ? msgs[msgs.length - 1].at : 0;
}

export function dmSend(partnerKey, partner, text) {
  if (!partnerKey || me.guest) return null;
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) return null;
  const key = String(partnerKey);
  const map = read(DMS_KEY, {});
  const box = map[me.id] || (map[me.id] = {});
  const conv = box[key] || (box[key] = {
    partner: {
      id: key,
      name: String((partner && partner.name) || 'Creator').slice(0, 40),
      avatar: (partner && partner.avatar) || '',
    },
    messages: [],
  });
  const msg = { id: 'm' + stamp() + Math.random().toString(36).slice(2, 6), from: 'me', text: clean, at: stamp() };
  conv.messages.push(msg);
  if (conv.messages.length > 500) conv.messages.splice(0, conv.messages.length - 500);
  write(DMS_KEY, map);
  return msg;
}

export function dmConversation(partnerKey) {
  if (me.guest || !partnerKey) return null;
  return (read(DMS_KEY, {})[me.id] || {})[String(partnerKey)] || null;
}

// ---------------- Time helpers ----------------
export function timeAgo(ts) {
  if (!Number(ts)) return 'now';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
