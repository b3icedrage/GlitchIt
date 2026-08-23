// GlitchIt — Supabase authentication module
// Clean, simple auth with robust CDN loading and error handling.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=6';

let client = null;
let clientPromise = null;
let clientFailed = false;
let handle = '';

// CDN fallbacks for supabase-js - try each in order
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2',
  'https://unpkg.com/@supabase/supabase-js@2?module',
];

// Load supabase-js from one of the CDNs
async function loadSupabase() {
  for (const url of CDN_URLS) {
    try {
      console.log('[GlitchIt] Trying Supabase CDN:', url);
      const mod = await import(url);
      console.log('[GlitchIt] Supabase loaded from:', url);
      return mod;
    } catch (err) {
      console.warn('[GlitchIt] CDN failed:', url, err.message);
    }
  }
  throw new Error('Could not load Supabase from any CDN');
}

// Get or create the Supabase client
async function getClient() {
  if (!authAvailable()) return null;
  
  // Return existing client if available
  if (client) return client;
  
  // Wait for existing initialization if in progress
  if (clientPromise) return clientPromise;
  
  // Start new initialization
  clientPromise = (async () => {
    try {
      const mod = await loadSupabase();
      client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      return client;
    } catch (err) {
      console.error('[GlitchIt] Failed to initialize Supabase:', err);
      clientFailed = true;
      clientPromise = null;
      return null;
    }
  })();
  
  return clientPromise;
}

// Check if auth is configured
export function authAvailable() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Get the current user or null
export async function currentUser() {
  try {
    const sb = await getClient();
    if (!sb) return null;
    
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) {
      console.warn('[GlitchIt] getSession error:', error);
      return null;
    }
    
    if (session?.user) {
      handle = userHandle(session.user);
      return session.user;
    }
    return null;
  } catch (err) {
    console.error('[GlitchIt] currentUser error:', err);
    return null;
  }
}

// Sign in with email and password
export async function signIn(email, password) {
  try {
    const sb = await getClient();
    if (!sb) {
      return { ok: false, error: 'Could not connect to authentication service. Please check your internet connection and try again.' };
    }
    
    console.log('[GlitchIt] Signing in:', email);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    
    if (error) {
      console.error('[GlitchIt] Sign in error:', error);
      return { ok: false, error: formatError(error) };
    }
    
    console.log('[GlitchIt] Sign in successful');
    handle = userHandle(data.user);
    return { ok: true, user: data.user };
  } catch (err) {
    console.error('[GlitchIt] Sign in exception:', err);
    return { ok: false, error: 'Sign-in failed. Please check your internet connection and try again.' };
  }
}

// Sign up with email, password, and optional profile data
export async function signUp(email, password, username, profile = {}) {
  try {
    const sb = await getClient();
    if (!sb) {
      return { ok: false, error: 'Could not connect to authentication service. Please check your internet connection and try again.' };
    }
    
    console.log('[GlitchIt] Signing up:', email);
    
    // Prepare user metadata
    const metadata = {
      username: username || email.split('@')[0],
    };
    if (profile.avatarUrl) metadata.avatar_url = profile.avatarUrl;
    if (profile.interests?.length) metadata.interests = profile.interests;
    
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    
    if (error) {
      console.error('[GlitchIt] Sign up error:', error);
      return { ok: false, error: formatError(error) };
    }
    
    // Check if email confirmation is required
    if (data.user && !data.session) {
      console.log('[GlitchIt] Email confirmation required');
      return { 
        ok: false, 
        error: 'Please check your email for a confirmation link, then try signing in.' 
      };
    }
    
    console.log('[GlitchIt] Sign up successful');
    handle = userHandle(data.user);
    return { ok: true, user: data.user };
  } catch (err) {
    console.error('[GlitchIt] Sign up exception:', err);
    return { ok: false, error: 'Sign-up failed. Please check your internet connection and try again.' };
  }
}

// Sign in with Google via Firebase Auth
export async function signInWithGoogle() {
  try {
    const fb = await import('./firebase.js?v=1');
    if (!fb.firebaseReady()) {
      return { ok: false, error: 'Firebase not loaded. Please refresh and try again.' };
    }
    const result = await fb.signInWithGoogle();
    return result;
  } catch (err) {
    console.error('[GlitchIt] Google sign-in exception:', err);
    return { ok: false, error: 'Google sign-in failed. Please try again.' };
  }
}

// Sign out
export async function signOut() {
  try {
    const sb = await getClient();
    if (sb) {
      await sb.auth.signOut();
    }
    handle = '';
  } catch (err) {
    console.error('[GlitchIt] Sign out error:', err);
  }
}

// Update user metadata (profile)
export async function updateUserMetadata(data) {
  try {
    const sb = await getClient();
    if (!sb) return { ok: false, error: 'Not connected' };
    
    const { data: updated, error } = await sb.auth.updateUser({ data });
    if (error) return { ok: false, error: error.message };
    
    if (updated?.user) handle = userHandle(updated.user);
    return { ok: true, user: updated?.user };
  } catch (err) {
    console.error('[GlitchIt] Update metadata error:', err);
    return { ok: false, error: 'Update failed' };
  }
}

// Get current handle
export function currentHandle() {
  return handle;
}

// Set handle
export function setHandle(value) {
  handle = value || '';
}

// Extract display handle from user object
export function userHandle(user) {
  if (!user) return '';
  return user.user_metadata?.username || user.email?.split('@')[0] || user.id || '';
}

// Format Supabase errors into user-friendly messages
function formatError(error) {
  const msg = String(error?.message || error || '');
  
  // Rate limiting
  if (/rate limit|over_email_send_rate_limit/i.test(msg)) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  
  // Invalid credentials
  if (/invalid.*login.*credentials|invalid.*grant/i.test(msg)) {
    return 'Invalid email or password. Please try again.';
  }
  
  // User not found
  if (/user.*not.*found|no.*user/i.test(msg)) {
    return 'No account found with this email. Please sign up first.';
  }
  
  // Email already registered
  if (/already.*registered|user.*already.*exists/i.test(msg)) {
    return 'This email is already registered. Please sign in.';
  }
  
  // Weak password
  if (/password.*length|password.*short/i.test(msg)) {
    return 'Password must be at least 6 characters.';
  }
  
  // Network errors
  if (/network|fetch|timeout|cors/i.test(msg)) {
    return 'Network error. Please check your internet connection and try again.';
  }
  
  // Return original message for other errors
  return msg || 'An unexpected error occurred. Please try again.';
}
