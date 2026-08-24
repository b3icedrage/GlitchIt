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

const FIREBASE_SA = {
  type: 'service_account',
  project_id: 'glitchit-749c0',
  private_key_id: '581c56c5f13dd5e392636c289ffe1e8a9153ef7f',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDpLEHvmaM99zh7\n6vWzpM7v+YVdWfaO1i/M9xa4g1hCpSgP7kivN7mP5hA+AP7uMW53dBikgoaFn8PN\nlSrG3FptQ0/hPwApMOgfjjKzSc42rdI/OSfzW5xd8xDa57QzEfIXpQSO3WH9I6b7\nzodTYSHYxswMyjRdWuLo7o4ZC6iv3iVbhR3deMjycC2gK4q5x3+gUWXgriyc/GR7\nEBqNbAGrD0gNGNTMIbiBu1K4rYKUOjc5lw+H0vSfwGYKkBQLjsaBHFzitegRL1qm\niXWHhzxsjC7PiRf5zXAA6psbOEHDxz+3Bz4zyW9QutjhgMIJKO91g+GARMEqvsEq\nKKS+jAMHAgMBAAECggEAAfGxGVqWnmxMc/7QesgAksZ9jJhId3x9dQASjk8Mz69J\nX+Dv2G+wZB4aD2mrZ7OMWNDaaSFYZRhIVzqpH9ZWRK0GzpbvOq2dXYlfjp00WCTA\nLfnErQFDV8QctA6KvOUxSzLxrfou8O6Rb5VYNM+mF1OmOrv+P7NSaJ/uGelH2+Qf\nxcxGPcmKWWoEgBSw8fJT58g/g/fnHev092HATdA8GRWMVU1Ity5JBHt0YHJr5PVf\nGA39xu5JQHLzDvPwfhBP2TNkCy/6fW8AiBEnQpGWPFXKysnqWtcb49j1ADIKIL6q\n4CL3wSyJR1gsQRbWXyuY8gWCFkiNoPTMhiDm3OHq3QKBgQD7kz/MiUPeIjaTYf6R\n9h/aTTQrGqBBhj5EGMsiPPeNH58AeBDETkdRdCpeGw7QPIO3g1CpHdc9Kt5vLHmE\njdsCVjRHr6Y3wPb08E5zk9p3ervFWgTQB3MnQsE5Qx4aX4gK5a4vuM7sZ/jLBmmn\nd2+HiWNaH9ZgdF13xfCRJj3oZQKBgQDtRiZFIxSLcMkBCGgQFrjZ+sQJ7hhwC5cY\nWcndgeG2LwVyKO7USaIEc8jhoipLWLk7M4Xsv4uWUSoOVp7CBABjr7kHLgqh3fa3\nIGvwXn4sSSP61jgVEQnYpbDnfmtXZ+kbnEhLqVmfDqOlOJ8YebNxAJ5lj+HeVqQz\nmqdwld4I+wKBgQDkx/kZ+a6FgRmemFxYwroe3VzW4iTg0cMoTF/W6Bi79wiy9X1R\n+Fn1Ii4xXGvxRUcHiVy+HwwRbT3RXmG4AQUtL9XlZ0BCrbIn961wgAIJ68x84atE\nv7Gh/5wWhgoHM99VAaCRd4B+DuN7Rn6os/3yBSgb2p4rI0eo15I5fcyI3QKBgQCx\noIBp5ZctxGNVuJte4APGe6pi3LHCv4p/mkg64U69+nmTOv2AQxddSeiqsaIEAgm5\nPhsWX1b6Uwyu6z2ydRhtiFF2BIvFHcvi0Ay+R58hPCgJUnFto/HBFFlZFBT7vDiQ\niPC+Y6tKHcV4nOjNg95HzHTIB2zJ7AbE8xRCfo9YHQKBgQDZaYn0oMFQBPeYa3Wx\nnv3OfQv+UOVp0cCeOOQqEns7gGUxWpvLOVQByNEMz/XDd89j0sIRe5tdBWUEq+ow\n6c9uaQ70Kko6N0OvKbOkgqXD/TiqACTPCjU0IBxmc271r0TntMbXYPl46V2p4+rp\nN4z13eVpjaqOXZ+L4RmmPQeAbA==\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk-fbsvc@glitchit-749c0.iam.gserviceaccount.com',
  client_id: '115303736996261420746',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40glitchit-749c0.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
};

function getAdminApp() {
  if (adminApp) return adminApp;
  if (!admin) return null;

  try {
    // Try env var first, fall back to hardcoded service account
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount;
    if (saJson) {
      serviceAccount = JSON.parse(saJson);
    } else {
      serviceAccount = FIREBASE_SA;
    }

    adminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
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
