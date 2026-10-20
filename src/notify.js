// GlitchIt — notifications + web push.
// Two halves:
//   1. In-app notifications: a Firestore `notifications` collection (one doc
//      per event, addressed to the recipient's uid) merged into activity.html
//      by src/social-wire.js. Works wherever the recipient signs in.
//   2. Web push: FCM registration tokens stored in `push_tokens/{uid}_{hash}`,
//      delivered server-side by /api/notify (firebase-admin, already in env).
// Every function degrades quietly: no API endpoint, no permission, or an
// offline Firestore all resolve without breaking the interaction that called
// them — push is an enhancement, never a requirement.
import { getStore, myUid, injectScript } from './safety.js?v=1';

const FB_VER = '11.8.1';
const PUSH_FLAG = 'glitchit.push';

function apiBase() {
  return (typeof window !== 'undefined' && window.GLITCHIT_API_BASE) || '';
}

function myName() {
  const me = window.GLITCHIT_USER || {};
  return String(me.user_metadata?.username || me.email?.split('@')[0] || '').slice(0, 60);
}

async function idToken() {
  try {
    const u = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
    return u ? await u.getIdToken() : '';
  } catch (err) {
    return '';
  }
}

// Friendly one-liners shared by the push payload and the Activity row.
const EVENT_LABEL = {
  like: 'liked your post',
  comment: 'commented on your post',
  follow: 'started following you',
  dm: 'sent you a message',
  reel: 'liked your reel',
  mention: 'mentioned you',
};

function eventTitle(type, fromName) {
  const who = fromName || 'Someone';
  return `${who} ${EVENT_LABEL[type] || 'interacted with your content'}`;
}

// ─── In-app notifications ───────────────────────────────────────────

// Fire a notification at another account. Called after a like / comment /
// follow / DM lands. Never throws; returns false when skipped or failed.
export async function sendNotification({ to, type, text, url }) {
  const from = myUid();
  if (!from || !to || String(to) === from) return false; // no self-notifications
  const payload = {
    to: String(to),
    from,
    fromName: myName(),
    type: String(type || 'mention'),
    text: String(text || '').slice(0, 140),
    url: String(url || '').slice(0, 300),
    at: new Date().toISOString(),
    read: false,
  };
  try {
    const store = await getStore();
    await store.collection('notifications').add(payload);
  } catch (err) {
    console.warn('[GlitchIt] notification write failed:', err && err.message);
  }
  // Best-effort push delivery — /api/notify may not exist on static hosting.
  try {
    const res = await fetch(`${apiBase()}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({
        action: 'send',
        to: payload.to,
        title: eventTitle(payload.type, payload.fromName),
        body: payload.text || eventTitle(payload.type, 'GlitchIt'),
        url: payload.url || 'activity.html',
        type: payload.type,
      }),
      keepalive: true,
    });
    return res.ok;
  } catch (err) {
    return false; // offline / endpoint absent — in-app row still recorded
  }
}

// Recent notifications addressed to me, newest first. Never throws.
export async function myNotifications(limit = 40) {
  const uid = myUid();
  if (!uid) return [];
  try {
    const store = await getStore();
    // Equality-only query: no composite index required.
    const snap = await store.collection('notifications').where('to', '==', uid).limit(200).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, Number(limit) || 40);
  } catch (err) {
    console.warn('[GlitchIt] notifications load failed:', err && err.message);
    return [];
  }
}

export async function markNotificationsRead(ids) {
  const uid = myUid();
  if (!uid || !ids || !ids.length) return;
  try {
    const store = await getStore();
    const batch = store.batch();
    ids.forEach((id) => batch.update(store.collection('notifications').doc(id), { read: true }));
    await batch.commit();
  } catch (err) {
    console.warn('[GlitchIt] notifications mark-read failed:', err && err.message);
  }
}

// ─── Web push (FCM) ─────────────────────────────────────────────────

export function pushSupported() {
  return typeof window !== 'undefined' && 'Notification' in window && typeof firebase !== 'undefined' && !!firebase.messaging;
}

export function pushState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    if (Notification.permission === 'granted' && localStorage.getItem(PUSH_FLAG) === '1') return 'on';
  } catch (err) { /* storage unavailable */ }
  return 'off';
}

async function ensureMessaging() {
  const store = await getStore(); // app-compat + Firestore initialized
  if (!firebase.messaging) {
    await injectScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-messaging-compat.js`);
  }
  if (!firebase.messaging) throw new Error('messaging-unavailable');
  return store;
}

// Registers this browser with FCM and stores the token under my uid.
async function registerToken(uid) {
  // Optional project VAPID key hook — set window.GLITCHIT_VAPID_KEY (e.g. from
  // Firebase Console → Cloud Messaging → Web Push certificates) before enable.
  const vapidKey = (typeof window !== 'undefined' && window.GLITCHIT_VAPID_KEY) || undefined;
  // Reuse the app's own service worker (sw.js, registered by main.js) instead
  // of letting the SDK hunt for /firebase-messaging-sw.js, which doesn't
  // exist here — that 404 is the classic "Registration failed" cause.
  let registration;
  try {
    if ('serviceWorker' in navigator) registration = await navigator.serviceWorker.ready;
  } catch (err) { registration = undefined; }
  const token = registration
    ? await firebase.messaging().getToken(vapidKey, registration)
    : await firebase.messaging().getToken(vapidKey);
  if (!token) throw new Error('no-token');
  const store = await getStore();
  const hash = String(token).replace(/[^A-Za-z0-9]/g, '').slice(-24) || String(Date.now());
  await store.collection('push_tokens').doc(`${uid}_${hash}`).set({
    uid,
    handle: myName(),
    token,
    ua: String(navigator.userAgent || '').slice(0, 120),
    at: new Date().toISOString(),
  }, { merge: true });
  try { localStorage.setItem(PUSH_FLAG, '1'); } catch (err) { /* ignore */ }
  return token;
}

export async function enablePush() {
  const uid = myUid();
  if (!uid) return { ok: false, reason: 'auth' };
  if (!('Notification' in window)) return { ok: false, reason: 'unsupported' };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    await ensureMessaging();
    await registerToken(uid);
    return { ok: true };
  } catch (err) {
    console.warn('[GlitchIt] enablePush failed:', err && err.message);
    return { ok: false, reason: /permission/i.test(String(err && err.message)) ? 'permission' : 'error', detail: String(err && err.message || err) };
  }
}

export async function disablePush() {
  const uid = myUid();
  try { localStorage.removeItem(PUSH_FLAG); } catch (err) { /* ignore */ }
  if (!uid) return { ok: true };
  try {
    await ensureMessaging();
    const vapidKey = (typeof window !== 'undefined' && window.GLITCHIT_VAPID_KEY) || undefined;
    const registration = ('serviceWorker' in navigator) ? await navigator.serviceWorker.ready.catch(() => null) : null;
    const token = await (registration
      ? firebase.messaging().getToken(vapidKey, registration)
      : firebase.messaging().getToken(vapidKey)).catch(() => null);
    if (token) {
      const store = await getStore();
      const hash = String(token).replace(/[^A-Za-z0-9]/g, '').slice(-24);
      await store.collection('push_tokens').doc(`${uid}_${hash}`).delete().catch(() => {});
    }
  } catch (err) { /* best-effort cleanup */ }
  return { ok: true };
}

// Silent re-registration for signed-in users who enabled push earlier (FCM
// tokens rotate; this keeps the stored one fresh). Never prompts.
export async function ensurePushRegistered() {
  if (pushState() !== 'on') return;
  try {
    const uid = myUid();
    if (!uid) return;
    await ensureMessaging();
    await registerToken(uid);
  } catch (err) { /* quiet */ }
}

// Globals consumed by src/social-wire.js and src/main.js (fire-and-forget).
try {
  window.GLITCHIT_NOTIFY = sendNotification;
  window.GLITCHIT_PUSH = { enable: enablePush, disable: disablePush, state: pushState, ensure: ensurePushRegistered };
} catch (err) { /* non-window context */ }
