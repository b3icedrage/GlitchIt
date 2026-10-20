// GlitchIt — trust & safety layer (reports + blocks) with a shared Firebase
// loader. Everything here is Firestore-backed so reports and block lists follow
// the account across devices, and every function is best-effort: failures
// resolve to { ok:false, reason } instead of throwing, and guests are refused
// up front. The compat SDK is injected on demand so pages that don't already
// load Firebase (admin, post permalinks) can still use this module.
import { FIREBASE_CONFIG } from './config.js?v=6';

const FB_VER = '11.8.1';
const BLOCKS_KEY = 'glitchit.blocks.v1';

let fbPromise = null;

// Inject a script tag once, with a hard timeout so a blocked CDN never hangs
// the UI. Exposed for src/notify.js (messaging compat SDK).
export function injectScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
    // Don't hang the UI if the CDN stalls (blocked region / offline).
    setTimeout(() => reject(new Error(`timeout loading ${src}`)), 8000);
  });
}

// Resolve a ready Firestore instance (compat), loading the SDK if the page
// didn't include it. Returns null instead of throwing so callers can no-op.
export function getStore() {
  if (!fbPromise) {
    fbPromise = (async () => {
      if (typeof firebase === 'undefined') {
        await injectScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`);
      }
      if (typeof firebase !== 'undefined' && !firebase.firestore) {
        await injectScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore-compat.js`);
      }
      if (typeof firebase === 'undefined' || !firebase.firestore) {
        throw new Error('firestore-unavailable');
      }
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      return firebase.firestore();
    })().catch((err) => {
      fbPromise = null; // allow a retry on the next interaction
      throw err;
    });
  }
  return fbPromise;
}

// The signed-in Firebase uid (null for guests / signed-out visitors).
export function myUid() {
  try {
    const u = window.GLITCHIT_USER;
    if (!u || u.guest || !u.id) return null;
    const fbUser = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
    // Only claim an identity Firebase actually has a session for — Firestore
            // rules check request.auth.uid, so a mismatch would just fail anyway.
    return fbUser && fbUser.uid === u.id ? fbUser.uid : null;
  } catch (err) {
    return null;
  }
}

// ─── Reports ────────────────────────────────────────────────────────
// Files a report into the `reports` collection the admin dashboard reads.

export async function reportContent({ type, targetId, targetOwner, reason, note }) {
  const uid = myUid();
  if (!uid) return { ok: false, reason: 'auth' };
  if (!type || !reason) return { ok: false, reason: 'bad-input' };
  try {
    const store = await getStore();
    const me = window.GLITCHIT_USER || {};
    await store.collection('reports').add({
      type: String(type),                       // 'post' | 'reel' | 'story' | 'user'
      targetId: String(targetId || ''),
      targetOwner: String(targetOwner || ''),
      reason: String(reason),
      note: String(note || '').slice(0, 500),
      from: uid,
      fromName: String(me.user_metadata?.username || me.email?.split('@')[0] || '').slice(0, 60),
      status: 'open',                           // open → acknowledged → dismissed
      at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    console.warn('[GlitchIt] report failed:', err && err.message);
    return { ok: false, reason: /permission/i.test(String(err && err.message)) ? 'permission' : 'error' };
  }
}

// Moderation queue for admin.html — newest first. Firestore has no cross-field
// default index needs here (single-field order), and status filtering happens
// client-side so no composite index is required.
export async function listReports(limit = 200) {
  try {
    const store = await getStore();
    const snap = await store.collection('reports').orderBy('at', 'desc').limit(Number(limit) || 200).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[GlitchIt] listReports failed:', err && err.message);
    throw err;
  }
}

export async function setReportStatus(id, status) {
  if (!id) return { ok: false, reason: 'bad-id' };
  try {
    const store = await getStore();
    await store.collection('reports').doc(id).update({ status: String(status || 'open'), resolved_at: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    console.warn('[GlitchIt] setReportStatus failed:', err && err.message);
    return { ok: false, reason: 'error' };
  }
}

// ─── Blocks ─────────────────────────────────────────────────────────
// One doc per account: blocks/{uid} = { list: [{ id, handle, at }] }.
// A localStorage mirror keeps filtering instant (and offline-capable) while
// Firestore keeps it in sync across devices.

function readLocalBlocks() {
  try {
    const raw = JSON.parse(localStorage.getItem(BLOCKS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    return [];
  }
}

function writeLocalBlocks(list) {
  try { localStorage.setItem(BLOCKS_KEY, JSON.stringify(list.slice(0, 500))); } catch (err) { /* ignore */ }
}

export async function loadBlocks() {
  const uid = myUid();
  if (!uid) return readLocalBlocks();
  try {
    const store = await getStore();
    const doc = await store.collection('blocks').doc(uid).get();
    if (doc.exists && Array.isArray(doc.data().list)) {
      writeLocalBlocks(doc.data().list);
      return doc.data().list;
    }
  } catch (err) {
    console.warn('[GlitchIt] loadBlocks failed:', err && err.message); // offline → keep mirror
  }
  return readLocalBlocks();
}

export async function blockUser(id, handle) {
  const uid = myUid();
  if (!id) return { ok: false, reason: 'bad-input' };
  const entry = { id: String(id), handle: String(handle || '').replace(/^@/, '').slice(0, 60), at: Date.now() };
  const next = readLocalBlocks().filter((b) => b.id !== entry.id);
  next.push(entry);
  writeLocalBlocks(next); // optimistic: filtering applies immediately
  if (!uid) return { ok: false, reason: 'auth' };
  try {
    const store = await getStore();
    await store.collection('blocks').doc(uid).set({
      list: next,
      updated_at: new Date().toISOString(),
    }, { merge: true });
    return { ok: true };
  } catch (err) {
    console.warn('[GlitchIt] blockUser failed:', err && err.message);
    return { ok: false, reason: /permission/i.test(String(err && err.message)) ? 'permission' : 'error' };
  }
}

export async function unblockUser(id) {
  const uid = myUid();
  const next = readLocalBlocks().filter((b) => b.id !== String(id));
  writeLocalBlocks(next);
  if (!uid) return { ok: false, reason: 'auth' };
  try {
    const store = await getStore();
    await store.collection('blocks').doc(uid).set({ list: next, updated_at: new Date().toISOString() }, { merge: true });
    return { ok: true };
  } catch (err) {
    console.warn('[GlitchIt] unblockUser failed:', err && err.message);
    return { ok: false, reason: 'error' };
  }
}

// Set-based lookup used by the feed filter: matches owner ids and handles.
let blockSetCache = null;
export function blockedSet() {
  if (!blockSetCache) {
    const set = new Set();
    for (const b of readLocalBlocks()) {
      if (b.id) set.add(String(b.id));
      if (b.handle) set.add(String(b.handle).replace(/^@/, '').toLowerCase());
    }
    blockSetCache = set;
  }
  return blockSetCache;
}

export function refreshBlockSet() {
  blockSetCache = null;
  return blockedSet();
}

export function isBlocked(id, handle) {
  const set = blockedSet();
  if (id && set.has(String(id))) return true;
  if (handle && set.has(String(handle).replace(/^@/, '').toLowerCase())) return true;
  return false;
}
