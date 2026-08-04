// GlitchIt — Supabase authentication (client-side, no build step).
// Loaded from main.js via dynamic import, same pattern as db.js. When the
// config is empty or the network fails, auth degrades gracefully (no gating).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=3';

let client = null;
let clientPromise = null;
let clientFailed = false;
let handle = '';

export function authAvailable() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getClient() {
  if (!authAvailable()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')
      .then((mod) => {
        client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        return client;
      })
      .catch((err) => {
        console.warn('GlitchIt: auth client failed to load', err);
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

export async function signUp(email, password, username) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: notReadyReason() };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { username: username || email.split('@')[0] } },
  });
  if (error) return { ok: false, error: error.message };
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
  if (error) return { ok: false, error: error.message };
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
  if (clientFailed) return 'Could not load the Supabase client (network or an ad-blocker may be blocking the CDN). Check your connection and refresh.';
  return 'Supabase is not ready yet. Check your connection and refresh.';
}
