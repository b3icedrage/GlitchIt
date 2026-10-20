// GlitchIt — /api/moderate: the trust & safety queue behind admin.html.
//
//   GET  /api/moderate              → list open reports (newest first)
//   POST /api/moderate { id, status }        → acknowledge / dismiss a report
//   POST /api/moderate { id, action:'remove' } → delete the reported media row
//
// Auth: HTTP Basic with the same admin credentials admin.html uses. All
// Firestore access happens admin-side (firebase-admin bypasses security
// rules), so the `reports` collection never needs public read access.
//
// Env: FIREBASE_SERVICE_ACCOUNT (JSON string). Missing key → graceful
// { ok:false } so the dashboard shows "not configured" instead of breaking.
'use strict';

// Shared bootstrap: env-first credential resolution (borrowing the project
// service account from accounts.js when env is unset/malformed) plus
// firebase-admin v14 (modular) / legacy namespace compatibility.
const shared = require('./_admin.js');

const ADMIN_USER = process.env.ADMIN_USER || 'Nm';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Brian69#$756';

const MEDIA_COLLECTIONS = ['media_posts', 'media_reels', 'media_stories'];
const VALID_STATUS = new Set(['open', 'acknowledged', 'dismissed']);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  try {
    const [user, pass] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    return user === ADMIN_USER && pass === ADMIN_PASS;
  } catch (e) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="GlitchIt Admin"');
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  const app = shared.getAdminApp();
  if (!app) {
    json(res, 200, { ok: false, error: 'Moderation is not configured yet.', reports: [] });
    return;
  }

  const db = shared.getDb(app);

  if (req.method === 'GET') {
    try {
      const snap = await db.collection('reports').orderBy('at', 'desc').limit(200).get();
      const reports = snap.docs.map((d) => {
        const row = d.data() || {};
        return {
          id: d.id,
          type: String(row.type || ''),
          targetId: String(row.targetId || ''),
          targetOwner: String(row.targetOwner || ''),
          reason: String(row.reason || ''),
          note: String(row.note || ''),
          fromName: String(row.fromName || ''),
          status: String(row.status || 'open'),
          at: String(row.at || ''),
        };
      });
      json(res, 200, { ok: true, reports });
    } catch (err) {
      console.warn('[Moderate] list failed:', err && err.message);
      json(res, 502, { ok: false, error: 'Could not load reports.', reports: [] });
    }
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

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

  const id = String(body.id || '').trim();
  if (!id) { json(res, 400, { ok: false, error: 'Missing report id' }); return; }

  try {
    if (body.action === 'remove') {
      // Delete the reported content from every media collection it could live
      // in, then mark the report acknowledged. Admin-side, so ownership rules
      // don't apply (that's the point of a moderation queue).
      const reportSnap = await db.collection('reports').doc(id).get();
      const report = reportSnap.exists ? (reportSnap.data() || {}) : {};
      const targetId = String(report.targetId || body.targetId || '').trim();
      let removed = 0;
      if (targetId) {
        for (const collection of MEDIA_COLLECTIONS) {
          const ref = db.collection(collection).doc(targetId);
          const doc = await ref.get().catch(() => null);
          if (doc && doc.exists) { await ref.delete(); removed += 1; }
        }
      }
      await db.collection('reports').doc(id).set(
        { status: 'acknowledged', resolved_at: new Date().toISOString(), removed },
        { merge: true },
      );
      json(res, 200, { ok: true, removed });
      return;
    }

    const status = String(body.status || '').trim();
    if (!VALID_STATUS.has(status)) {
      json(res, 400, { ok: false, error: 'Status must be open, acknowledged or dismissed' });
      return;
    }
    await db.collection('reports').doc(id).set(
      { status, resolved_at: new Date().toISOString() },
      { merge: true },
    );
    json(res, 200, { ok: true, status });
  } catch (err) {
    console.warn('[Moderate] update failed:', err && err.message);
    json(res, 502, { ok: false, error: 'Could not update the report.' });
  }
};
