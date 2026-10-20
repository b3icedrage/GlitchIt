// GlitchIt — shared Firebase Admin bootstrap for the api/ functions.
//
// One module owns service-account resolution, app init and service accessors
// so /api/accounts, /api/notify and /api/moderate can't drift apart (and so
// the default app is created once per process — the preview server loads all
// of them together).
//
// Credential resolution order:
//   1. FIREBASE_SERVICE_ACCOUNT env var (JSON string; tolerant of the common
//      .env quoting artifacts — string-escaped or double-encoded JSON).
//   2. The project's built-in service account, borrowed from api/accounts.js
//      (single source of truth — this module never duplicates the key), so
//      the endpoints work before env keys are configured.
//
// firebase-admin v13+ moved every service into subpath exports
// (firebase-admin/app, /auth, /firestore, /messaging); older versions expose
// them on the namespace. Both shapes are supported so an SDK bump can't
// silently disable pushes or moderation.
'use strict';

let admin = null;
try { admin = require('firebase-admin'); } catch (e) { /* optional dep */ }

let appMod = null; let authMod = null; let fsMod = null; let msgMod = null;
try {
  if (admin) {
    appMod = require('firebase-admin/app');
    authMod = require('firebase-admin/auth');
    fsMod = require('firebase-admin/firestore');
    msgMod = require('firebase-admin/messaging');
  }
} catch (e) { /* legacy namespace-style SDK: use admin.* below */ }

// .env files often store JSON string-escaped or double-encoded. Accept the
// common shapes instead of failing the whole endpoint on a quoting artifact.
function parseServiceAccount(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const attempts = [v];
  if (v.startsWith('"') && v.endsWith('"')) attempts.push(v.slice(1, -1));
  attempts.push(v.replace(/\\"/g, '"').replace(/\\n/g, '\n'));
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const obj = JSON.parse(attempt);
      if (obj && typeof obj === 'object') return obj;
      if (typeof obj === 'string') {
        try {
          const inner = JSON.parse(obj);
          if (inner && typeof inner === 'object') return inner;
        } catch (e) { /* next shape */ }
      }
    } catch (e) { /* next shape */ }
  }
  return null;
}

// Fallback credential — borrowed (not copied) from api/accounts.js, which has
// always shipped the project service account. Resolved lazily to avoid a
// circular require at module-load time.
function fallbackCredential() {
  try {
    return require('./accounts.js').FIREBASE_SA || null;
  } catch (e) {
    return null;
  }
}

function certCredential(json) {
  if (appMod && appMod.cert) return appMod.cert(json);
  if (admin.credential && admin.credential.cert) return admin.credential.cert(json);
  if (admin.cert) return admin.cert(json);
  throw new Error('no credential builder in this firebase-admin version');
}

let cachedApp = null;

// Returns the default Firebase Admin app, or null when the SDK/credential is
// unavailable (callers answer { ok:false } and the app degrades gracefully).
function getAdminApp() {
  if (cachedApp) return cachedApp;
  if (!admin) return null;
  try {
    const { getApps, initializeApp } = appMod || admin;
    // The preview server shares one process across api/* handlers, so reuse
    // the default app instead of colliding on a second initializeApp() call.
    const existing = getApps()[0];
    if (existing) { cachedApp = existing; return cachedApp; }
    const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT) || fallbackCredential();
    if (!serviceAccount) {
      console.warn('[Admin] No service account — set FIREBASE_SERVICE_ACCOUNT');
      return null;
    }
    cachedApp = initializeApp({ credential: certCredential(serviceAccount) });
    return cachedApp;
  } catch (e) {
    console.warn('[Admin] Firebase Admin init failed:', e.message);
    return null;
  }
}

function getAuthService(app) { return authMod ? authMod.getAuth(app) : admin.auth(app); }
function getDb(app) { return fsMod ? fsMod.getFirestore(app) : admin.firestore(app); }
function getMessagingService(app) { return msgMod ? msgMod.getMessaging(app) : admin.messaging(app); }

module.exports = { getAdminApp, getAuthService, getDb, getMessagingService };
