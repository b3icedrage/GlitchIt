// GlitchIt — POST /api/notify: deliver a web push to one account's devices.
//
// The client (src/notify.js) sends the sender's Firebase ID token in
// Authorization: Bearer <token>. We verify it with firebase-admin, look up
// the recipient's FCM registration tokens in `push_tokens/{uid}_{hash}`, and
// multicast the message. Invalid/unregistered tokens are pruned as we go so
// the collection doesn't rot.
//
// Credential: FIREBASE_SERVICE_ACCOUNT env var, falling back to the project
// service account api/accounts.js ships (see api/_admin.js). When neither
// works the endpoint reports { ok:false } and the client falls back to
// in-app activity rows only, so nothing breaks.
'use strict';

// Shared bootstrap: env-first credential resolution (borrowing the project
// service account from accounts.js when env is unset/malformed) plus
// firebase-admin v14 (modular) / legacy namespace compatibility.
const shared = require('./_admin.js');

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

const MAX_TITLE = 120;
const MAX_BODY = 200;
const MAX_URL = 300;
const ALLOWED_TYPES = new Set(['like', 'comment', 'follow', 'dm', 'reel', 'mention']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const app = shared.getAdminApp();
  if (!app) {
    json(res, 200, { ok: false, error: 'Push delivery is not configured yet.', sent: 0 });
    return;
  }

  // Read the body with a hard cap (push payloads are tiny).
  let raw = '';
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8192) { json(res, 413, { ok: false, error: 'Payload too large' }); return; }
    }
  } catch (e) {
    json(res, 400, { ok: false, error: 'Could not read request body' });
    return;
  }

  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { json(res, 400, { ok: false, error: 'Invalid JSON' }); return; }

  const to = String(body.to || '').trim();
  const title = String(body.title || '').trim().slice(0, MAX_TITLE);
  const text = String(body.body || body.text || '').trim().slice(0, MAX_BODY);
  const url = String(body.url || './activity.html').slice(0, MAX_URL);
  const type = ALLOWED_TYPES.has(body.type) ? body.type : 'mention';

  if (!to || to.length > 128) {
    json(res, 400, { ok: false, error: 'Missing recipient' });
    return;
  }
  if (!title && !text) {
    json(res, 400, { ok: false, error: 'Empty message' });
    return;
  }

  // Verify the sender. Any signed-in user may notify, but only as themselves.
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    json(res, 401, { ok: false, error: 'Sign in to send notifications' });
    return;
  }

  let sender;
  try {
    sender = await shared.getAuthService(app).verifyIdToken(idToken);
  } catch (e) {
    json(res, 401, { ok: false, error: 'Invalid session' });
    return;
  }
  if (!sender || !sender.uid) {
    json(res, 401, { ok: false, error: 'Invalid session' });
    return;
  }
  if (sender.uid === to) {
    json(res, 200, { ok: true, sent: 0, skipped: 'self' }); // no self-notifications
    return;
  }

  const db = shared.getDb(app);
  try {
    const snap = await db.collection('push_tokens').where('uid', '==', to).limit(10).get();
    if (snap.empty) {
      json(res, 200, { ok: true, sent: 0, skipped: 'no-tokens' });
      return;
    }
    const tokens = [];
    const docs = [];
    snap.docs.forEach((doc) => {
      const t = doc.data() && doc.data().token;
      if (t) { tokens.push(t); docs.push(doc); }
    });
    if (!tokens.length) {
      json(res, 200, { ok: true, sent: 0, skipped: 'no-tokens' });
      return;
    }

    const message = {
      notification: { title: title || 'GlitchIt', body: text || 'You have a new notification' },
      data: { url, type },
      webpush: {
        fcm_options: { link: url },
        notification: { icon: '/icon.svg', badge: '/icon.svg' },
      },
      tokens,
    };
    const response = await shared.getMessagingService(app).sendEachForMulticast(message);
    // Prune tokens FCM reports dead so future sends stay cheap.
    const invalid = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error && /registration-token-not-valid|invalid-registration|not-registered/i.test(r.error.code || '')) {
        invalid.push(docs[i].ref);
      }
    });
    if (invalid.length) {
      const batch = db.batch();
      invalid.forEach((ref) => batch.delete(ref));
      await batch.commit().catch(() => { /* best-effort */ });
    }
    json(res, 200, { ok: true, sent: response.successCount, failed: response.failureCount });
  } catch (err) {
    console.warn('[Notify] send failed:', err && err.message);
    json(res, 502, { ok: false, error: 'Could not reach the push service.' });
  }
};
