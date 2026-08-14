// GlitchIt — GET /api/accounts: list every registered GlitchIt account.
// The browser's anon key cannot read auth.users (Supabase keeps that schema
// behind the Admin API), which is why the search page's Accounts tab only ever
// saw accounts that had posted media. This serverless endpoint calls the
// Supabase Admin API with the service-role key (kept in server env) and
// returns only display-safe fields — id, username, avatar — never emails.
//
// Required env var (Vercel → Project → Settings → Environment Variables,
// and .env.local for the preview):
//   SUPABASE_SERVICE_ROLE_KEY - from Supabase → Settings → API → service_role
//
// When the key is missing the endpoint reports { ok:false } and the app falls
// back to the media-derived creator list, so search never breaks.
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://socaxjkikrxantwxacqy.supabase.co';

function sanitize(user) {
  const meta = (user && user.user_metadata) || {};
  const identity = (user && user.identities && user.identities[0] && user.identities[0].identity_data) || {};
  const username = String(meta.username || (user && user.email ? user.email.split('@')[0] : '') || '').trim();
  const avatar = [meta.avatar_url, meta.picture, meta.avatar, meta.image, identity.avatar_url, identity.picture]
    .find((v) => typeof v === 'string' && /^(?:https?:|data:image\/)/i.test(v)) || '';
  const bio = String(meta.bio || '').trim();
  return { id: String(user.id || ''), username, avatar, bio, created_at: String(user.created_at || '') };
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
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceRole) {
    json(res, 200, { ok: false, error: 'not configured', accounts: [] });
    return;
  }
  let data = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
    });
    if (!r.ok) throw new Error(`Supabase admin API error (${r.status})`);
    data = await r.json().catch(() => null);
  } catch (err) {
    console.warn('GlitchIt: accounts listing failed', err);
    json(res, 502, { ok: false, error: 'Could not reach the accounts service.' });
    return;
  }
  const accounts = (data && Array.isArray(data.users) ? data.users : [])
    .filter((u) => u && u.id)
    .map(sanitize)
    .filter((a) => a.id && a.username);
  json(res, 200, { ok: true, accounts });
};
