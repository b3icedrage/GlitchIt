// GlitchIt — Supabase authentication (client-side, no build step).
// Loaded from main.js via dynamic import, same pattern as db.js. When the
// config is empty or the network fails, auth degrades gracefully (no gating).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=3';

let client = null;
let clientPromise = null;
let clientFailed = false;
let handle = '';

// Try several CDNs so one blocked/unreachable mirror (ad-blocker, region, etc.)
// doesn't take down auth. First one that loads wins.
// Note: the bare jsDelivr URL serves a UMD build (no ESM exports), so we use
// the /+esm variant — import() needs named exports like createClient.
const SUPABASE_CDNS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2',
  'https://unpkg.com/@supabase/supabase-js@2?module',
  'https://cdn.skypack.dev/@supabase/supabase-js@2',
];

async function importSupabase() {
  let lastErr = null;
  for (const url of SUPABASE_CDNS) {
    try {
      return await import(url);
    } catch (err) {
      lastErr = err;
      console.warn(`GlitchIt: supabase-js unavailable from ${url}`, err);
    }
  }
  throw lastErr || new Error('All Supabase CDNs unreachable');
}

export function authAvailable() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getClient() {
  if (!authAvailable()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = importSupabase()
      .then((mod) => {
        client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        return client;
      })
      .catch((err) => {
        console.warn('GlitchIt: auth client failed to load from all CDNs', err);
        clientPromise = null;
        clientFailed = true;
        return null;
      });
  }
  return clientPromise;
}

// The handle used to tag posts/saves in the database.
export function currentHandle() {
  return handle;
}

export function setHandle(value) {
  handle = value || '';
}

// Derive a friendly handle from a Supabase user object.
export function userHandle(user) {
  if (!user) return '';
  return user.user_metadata?.username || user.email?.split('@')[0] || user.id || '';
}

// The signed-in user for this device, or null. Relies on supabase-js
// persisting the session in localStorage ("first check if this device has
// logged in").
export async function currentUser() {
  try {
    const sb = await getClient();
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      handle = userHandle(session.user);
      return session.user;
    }
    return null;
  } catch (err) {
    console.warn('GlitchIt: session read failed', err);
    return null;
  }
}

// Supabase caps confirmation emails per address/hour; turn the cryptic
// "Email rate limit exceeded" into an actionable message instead of
// showing the raw error string.
function friendlyError(error) {
  const msg = String(error?.message || error || '');
  if (/rate limit|over_email_send_rate_limit/i.test(msg)) {
    return 'Too many emails were sent to this address recently. Wait about an hour or try a different email. (You can also raise the email limits in Supabase: Authentication → Rate Limits.)';
  }
  return msg;
}

export async function signUp(email, password, username) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: notReadyReason() };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { username: username || email.split('@')[0] } },
  });
  if (error) return { ok: false, error: friendlyError(error) };
  if (data.user && !data.session) {
    // Email confirmation is enabled — the user must confirm before signing in.
    return { ok: false, error: 'Check your inbox to confirm your email, then log in.' };
  }
  handle = userHandle(data.user);
  return { ok: true, user: data.user };
}

export async function signIn(email, password) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: notReadyReason() };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: friendlyError(error) };
  handle = userHandle(data.user);
  return { ok: true, user: data.user };
}

export async function signOut() {
  handle = '';
  try {
    const sb = await getClient();
    if (!sb) return;
    await sb.auth.signOut();
  } catch (err) {
    console.warn('GlitchIt: sign out failed', err);
  }
}

// Distinguish "keys missing" from "client couldn't load" so the message
// never points you at config.js when the keys are actually present.
function notReadyReason() {
  if (!authAvailable()) return 'Supabase is not configured yet (src/config.js).';
  if (clientFailed) return 'Could not load the Supabase client from any CDN (network or an ad-blocker may be blocking them). Check your connection, disable ad-block for this site, and refresh.';
  return 'Supabase is not ready yet. Check your connection and refresh.';
}
