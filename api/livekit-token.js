// GlitchIt — GET /api/livekit-token: mint a LiveKit Cloud access token.
// LiveKit requires a signed JWT (API key + secret) to join a room, and the
// secret must never ship to the browser — so the token is minted here,
// server-side, and the client just fetches { url, token } for the room it
// wants to join. Works as a Vercel serverless function AND from server.js
// (same pattern as api/accounts.js).
//
// Required env vars (Vercel → Project Settings → Environment Variables, and
// .env.local for the preview):
//   LIVEKIT_URL        - e.g. wss://<project>.livekit.cloud  (project settings)
//   LIVEKIT_API_KEY    - from LiveKit Cloud → Settings → Keys
//   LIVEKIT_API_SECRET - same page, shown once when the key is created
//
// When the keys are missing the endpoint reports { ok:false } and the call
// overlay falls back to its built-in demo mode, so calling never breaks.
'use strict';

const crypto = require('node:crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Mint a LiveKit Cloud access token (HS256 JWT, zero dependencies).
// The video grant limits the token to exactly the room the caller asked for.
function mintLiveKitToken({ apiKey, apiSecret, room, identity, ttlSeconds = 3600 }) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    exp: now + ttlSeconds,
    nbf: now - 10,
    iss: apiKey,
    sub: apiKey,
    name: identity,
    identity,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  }));
  const signature = crypto.createHmac('sha256', String(apiSecret))
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sanitize(value, max, fallback) {
  const clean = String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, max);
  return clean || fallback;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.LIVEKIT_API_KEY || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || '';
  const livekitUrl = process.env.LIVEKIT_URL || '';
  if (!apiKey || !apiSecret || !livekitUrl) {
    json(res, 200, { ok: false, error: 'not configured', url: '', token: '' });
    return;
  }
  const url = new URL(req.url, 'http://glitchit.local');
  const room = sanitize(url.searchParams.get('room'), 80, '');
  if (!room) {
    json(res, 400, { ok: false, error: 'A room parameter is required.' });
    return;
  }
  const identity = sanitize(url.searchParams.get('identity'), 64, `guest-${Math.random().toString(36).slice(2, 8)}`);
  const token = mintLiveKitToken({ apiKey, apiSecret, room, identity });
  json(res, 200, { ok: true, url: livekitUrl, token, room, identity });
};

module.exports.mintLiveKitToken = mintLiveKitToken;
