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
const DM_READ_KEY = 'glitchit.social.dmread.v1';
const DM_PENDING_KEY = 'glitchit.social.dmpending.v1';

// Current identity ({ id, username, avatar }) — guests stay anonymous so they
// never write anything into the per-user stores.
let me = { id: '', username: 'you', avatar: '', guest: true };

export function setSocialUser(user) {
  if (user && !user.guest && user.id) {
    me = { id: String(user.id), username: String(user.username || user.id.slice(0, 8)), avatar: String(user.avatar || ''), guest: false };
  } else {
    me = { id: '', username: 'you', avatar: '', guest: true };
  }
  // Replies queued while this identity was away (or on another page) land now.
  processPendingDmReplies();
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
    userId: me.id,
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

// Remove one of your own comments (id from addComment). Returns true when the
// comment existed and was deleted, so callers can refresh counts + the list.
export function deleteComment(mediaKey, commentId) {
  if (!mediaKey || me.guest || !commentId) return false;
  const { map, box } = boxed(COMMENTS_KEY);
  const list = box[mediaKey] || [];
  const next = list.filter((c) => c && c.id !== commentId);
  if (next.length === list.length) return false;
  box[mediaKey] = next;
  write(COMMENTS_KEY, map);
  return true;
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

// ---------------- Incoming messages (creator replies) ----------------
// DMs are two-way now: besides dmSend (from "me"), creators reply with
// dmReceive (from "them"). Unread state is tracked per conversation so the
// inbox and nav can badge new replies.

export function dmReceive(partnerKey, partner, text) {
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
  const msg = { id: 'm' + stamp() + Math.random().toString(36).slice(2, 6), from: 'them', text: clean, at: stamp() };
  conv.messages.push(msg);
  if (conv.messages.length > 500) conv.messages.splice(0, conv.messages.length - 500);
  write(DMS_KEY, map);
  return msg;
}

// Partner keys with at least one unread incoming message.
export function dmUnread() {
  if (me.guest) return [];
  const map = read(DMS_KEY, {})[me.id] || {};
  const readAt = read(DM_READ_KEY, {})[me.id] || {};
  return Object.keys(map).filter((key) => {
    const conv = map[key];
    const last = conv && conv.messages && conv.messages[conv.messages.length - 1];
    return Boolean(last && last.from !== 'me' && last.at > (Number(readAt[key]) || 0));
  });
}

export function dmUnreadTotal() {
  return dmUnread().length;
}

// Mark one conversation read (called when the chat page opens it).
export function dmMarkRead(partnerKey) {
  if (me.guest || !partnerKey) return;
  const all = read(DM_READ_KEY, {});
  const box = all[me.id] || (all[me.id] = {});
  box[String(partnerKey)] = stamp();
  write(DM_READ_KEY, all);
}

// ---------------- Creator auto-replies ----------------
// Creators answer within a few seconds so conversations feel alive. Replies
// are scheduled into a persisted queue (survives navigation) and land through
// dmReceive; the UI re-renders on the 'glitchit:dm' event.
const CREATOR_REPLIES = [
  'hey! thanks for reaching out 🙌',
  'got your message — what\'s on your mind?',
  'appreciate the support! what brings you by?',
  'hi! happy to chat ⚡',
  'thanks for the message! how are you?',
  'love the energy — tell me more!',
  'hey! glad you found me here ✨',
  'yo! appreciate you stopping by.',
  'just saw your message — what\'s up?',
];
const STORY_REPLIES = [
  'so glad you liked the story! 💜',
  'haha thanks for the shout on the story!',
  'thanks for watching! more coming soon ⚡',
  'aw appreciate the love on the story!',
  'glad you caught that story ✨',
];

function readPendingReplies() {
  try {
    const list = JSON.parse(localStorage.getItem(DM_PENDING_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) { return []; }
}
function writePendingReplies(list) {
  try { localStorage.setItem(DM_PENDING_KEY, JSON.stringify(list)); } catch (err) { /* storage unavailable */ }
}

let pendingTimer = null;
function armPendingTimer() {
  clearTimeout(pendingTimer);
  const list = readPendingReplies();
  if (!list.length) return;
  const soonest = Math.min(...list.map((p) => p.due));
  pendingTimer = setTimeout(processPendingReplies, Math.max(0, soonest - Date.now()));
}

// Land every reply whose time has come, then re-arm for the rest. Replies are
// scoped to the user who scheduled them (another account on this device never
// receives them) and stale entries expire after 30 minutes.
function processPendingReplies() {
  const now = Date.now();
  const list = readPendingReplies();
  const due = list.filter((p) => p && p.userId === me.id && p.due <= now);
  const rest = list.filter((p) => {
    if (!p) return false;
    if (p.userId === me.id) return p.due > now;
    return p.due > now - 30 * 60 * 1000;
  });
  writePendingReplies(rest);
  due.forEach((p) => dmReceive(p.key, p.partner, p.text));
  if (due.length) {
    try {
      window.dispatchEvent(new CustomEvent('glitchit:dm', { detail: { keys: due.map((p) => String(p.key)) } }));
    } catch (err) { /* ignore */ }
  }
  if (rest.length) armPendingTimer();
}

// Queue a creator reply ~2–4s out. Works from anywhere (chat page, story
// viewer, inbox) and survives navigation thanks to the persisted queue.
export function scheduleCreatorReply(partnerKey, partner, opts) {
  if (me.guest || !partnerKey) return;
  const pool = opts && opts.story ? STORY_REPLIES : CREATOR_REPLIES;
  const text = pool[Math.floor(Math.random() * pool.length)];
  const due = Date.now() + 2000 + Math.floor(Math.random() * 2200);
  const list = readPendingReplies();
  list.push({ userId: me.id, key: String(partnerKey), partner: { name: String((partner && partner.name) || 'Creator').slice(0, 40), avatar: (partner && partner.avatar) || '' }, text, due });
  writePendingReplies(list);
  armPendingTimer();
}

// Land any replies that were queued while the page was closed/away. Called
// on identity change and by pages that show DM state.
export function processPendingDmReplies() {
  processPendingReplies();
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
