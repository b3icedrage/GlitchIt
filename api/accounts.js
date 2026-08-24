// GlitchIt — GET /api/accounts: list every registered GlitchIt account.
// Uses Firebase Admin SDK to read users from Firebase Auth + Firestore profiles.
//
// Required env var (Vercel → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT - JSON string of Firebase service account credentials
//   (or individual FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
//
// When the key is missing the endpoint reports { ok:false } and the app falls
// back to the media-derived creator list, so search never breaks.
'use strict';

let admin = null;
try { admin = require('firebase-admin'); } catch (e) { /* firebase-admin optional */ }

let adminApp = null;

function getAdminApp() {
  if (adminApp) return adminApp;
  if (!admin) return null;

  try {
    // Try service account JSON string first
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (saJson) {
      const serviceAccount = JSON.parse(saJson);
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      return adminApp;
    }

    // Try individual env vars
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (projectId && clientEmail && privateKey) {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      return adminApp;
    }

    // Try default credentials (e.g., GCP service account)
    adminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    return adminApp;
  } catch (e) {
    console.warn('[Accounts] Firebase Admin init failed:', e.message);
    return null;
  }
}

function sanitize(fbUser, profile) {
  const username = (profile && profile.username) || fbUser.displayName || (fbUser.email ? fbUser.email.split('@')[0] : '') || '';
  const avatar = (profile && profile.avatar_url) || fbUser.photoURL || '';
  const bio = (profile && profile.bio) || '';
  // Check if user has active premium
  let verified = false;
  try {
    const prem = profile && profile.premium;
    if (prem && prem.expiresAt && Date.now() < prem.expiresAt) {
      verified = true;
    }
  } catch (e) { /* ignore */ }
  return {
    id: String(fbUser.uid || ''),
    username: String(username).trim(),
    avatar,
    bio,
    verified,
    created_at: String(fbUser.metadata?.creationTime || ''),
  };
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const app = getAdminApp();
  if (!app) {
    json(res, 200, { ok: false, error: 'Firebase Admin not configured', accounts: [] });
    return;
  }

  try {
    // List users from Firebase Auth (max 1000)
    const listResult = await admin.auth(app).listUsers({ maxResults: 200 });
    const fbUsers = listResult.users || [];

    // Load profiles from Firestore
    const db = admin.firestore(app);
    const accounts = [];

    for (const fbUser of fbUsers) {
      let profile = null;
      try {
        const doc = await db.collection('users').doc(fbUser.uid).get();
        if (doc.exists) profile = doc.data();
      } catch (_) { /* profile not found — use defaults */ }

      const account = sanitize(fbUser, profile);
      if (account.id && account.username) {
        accounts.push(account);
      }
    }

    json(res, 200, { ok: true, accounts });
  } catch (err) {
    console.warn('GlitchIt: accounts listing failed', err);
    json(res, 502, { ok: false, error: 'Could not reach the accounts service.' });
  }
};
