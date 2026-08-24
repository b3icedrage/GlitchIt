// GlitchIt — Firebase Authentication module
// Uses Firebase Auth (compat SDK loaded via CDN in HTML pages) + Firestore for profiles.
// Maintains the same export interface as the old Supabase module so main.js and
// other consumers don't need changes.

/* global firebase */

let handle = '';
let profileCache = {}; // Firestore profile data cache per uid

// ─── Firebase helpers ──────────────────────────────────────────────

function getAuth() {
  try { return firebase && firebase.auth ? firebase.auth() : null; }
  catch (_) { return null; }
}

function getFirestore() {
  try { return firebase && firebase.firestore ? firebase.firestore() : null; }
  catch (_) { return null; }
}

// ─── Profile (Firestore) ───────────────────────────────────────────
// User profiles live in Firestore collection 'users', doc ID = Firebase UID.
// Fields: username, full_name, avatar_url, bio, interests, premium, created_at

async function getProfile(uid) {
  if (profileCache[uid]) return profileCache[uid];
  const db = getFirestore();
  if (!db) return null;
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) {
      profileCache[uid] = doc.data();
      return profileCache[uid];
    }
  } catch (e) { console.warn('[GlitchIt] getProfile error:', e.message); }
  return null;
}

async function setProfile(uid, data) {
  const db = getFirestore();
  if (!db) return;
  try {
    await db.collection('users').doc(uid).set(data, { merge: true });
    profileCache[uid] = { ...(profileCache[uid] || {}), ...data };
  } catch (e) { console.warn('[GlitchIt] setProfile error:', e.message); }
}

// Build a Supabase-compatible user object from Firebase auth + Firestore profile
async function buildUserObj(fbUser) {
  if (!fbUser) return null;
  const uid = fbUser.uid;
  const email = fbUser.email || '';
  const displayName = fbUser.displayName || '';

  // Get profile from Firestore
  const prof = await getProfile(uid);

  const username = (prof && prof.username) || displayName || email.split('@')[0] || '';
  const avatarUrl = (prof && prof.avatar_url) || fbUser.photoURL || '';

  return {
    id: uid,
    email: email,
    user_metadata: {
      username: username,
      full_name: (prof && prof.full_name) || displayName || '',
      avatar_url: avatarUrl,
      bio: (prof && prof.bio) || '',
      interests: (prof && prof.interests) || [],
      premium: (prof && prof.premium) || null,
    },
  };
}

// ─── Exported interface (same as old Supabase module) ──────────────

export function authAvailable() {
  return !!getAuth();
}

export async function currentUser() {
  const auth = getAuth();
  if (!auth) return null;
  const fbUser = auth.currentUser;
  if (!fbUser) return null;
  handle = fbUser.displayName || fbUser.email?.split('@')[0] || '';
  return buildUserObj(fbUser);
}

export async function signIn(email, password) {
  const auth = getAuth();
  if (!auth) return { ok: false, error: 'Could not connect to authentication service.' };

  try {
    console.log('[GlitchIt] Signing in:', email);
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const user = await buildUserObj(cred.user);
    handle = user?.user_metadata?.username || '';
    console.log('[GlitchIt] Sign in successful');
    return { ok: true, user };
  } catch (err) {
    console.error('[GlitchIt] Sign in error:', err);
    return { ok: false, error: formatError(err) };
  }
}

export async function signUp(email, password, username, profile = {}) {
  const auth = getAuth();
  if (!auth) return { ok: false, error: 'Could not connect to authentication service.' };

  try {
    console.log('[GlitchIt] Signing up:', email);
    const cred = await auth.createUserWithEmailAndPassword(email, password);

    // Set displayName on Firebase Auth
    const displayName = username || email.split('@')[0];
    await cred.user.updateProfile({ displayName });

    // Create profile in Firestore
    const profData = { username: displayName, created_at: new Date().toISOString() };
    if (profile.avatarUrl) profData.avatar_url = profile.avatarUrl;
    if (profile.interests?.length) profData.interests = profile.interests;
    await setProfile(cred.user.uid, profData);

    const user = await buildUserObj(cred.user);
    handle = user?.user_metadata?.username || '';
    console.log('[GlitchIt] Sign up successful');
    return { ok: true, user };
  } catch (err) {
    console.error('[GlitchIt] Sign up error:', err);
    return { ok: false, error: formatError(err) };
  }
}

export async function signInWithGoogle() {
  // Ensure Firebase is initialized before use (CDN scripts load async)
  try {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      if (!firebase.apps || !firebase.apps.length) {
        const { FIREBASE_CONFIG } = await import('./config.js?v=6');
        firebase.initializeApp(FIREBASE_CONFIG);
      }
    }
  } catch (_) { /* already initialized */ }

  // Wait for firebase.auth to become available (async CDN load)
  for (let i = 0; i < 30; i++) {
    if (typeof firebase !== 'undefined' && firebase.auth) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const auth = getAuth();
  if (!auth) return { ok: false, error: 'Firebase not loaded. Please refresh the page.' };

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    // Use redirect instead of popup — popups are blocked in APK WebViews
    // and many mobile browsers. Redirect works everywhere.
    await auth.signInWithRedirect(provider);
    // After redirect, Firebase will call getRedirectResult on the next page load.
    // The auth state listener in main.js will pick up the signed-in user.
    return { ok: true, pending: true };
  } catch (err) {
    console.error('[GlitchIt] Google sign-in error:', err);
    return { ok: false, error: err.message || 'Google sign-in failed.' };
  }
}

export async function signOut() {
  const auth = getAuth();
  if (auth) {
    try { await auth.signOut(); } catch (_) { /* ignore */ }
  }
  handle = '';
  profileCache = {};
}

export async function updateUserMetadata(data) {
  const auth = getAuth();
  if (!auth || !auth.currentUser) return { ok: false, error: 'Not signed in' };

  const uid = auth.currentUser.uid;

  // Update Firebase Auth displayName/photoURL if provided
  const authUpdate = {};
  if (data.username) authUpdate.displayName = data.username;
  if (data.avatar_url) authUpdate.photoURL = data.avatar_url;
  if (Object.keys(authUpdate).length > 0) {
    try { await auth.currentUser.updateProfile(authUpdate); } catch (_) { /* ignore */ }
  }

  // Update Firestore profile
  await setProfile(uid, data);

  // Rebuild user object
  const user = await buildUserObj(auth.currentUser);
  if (user) handle = user.user_metadata?.username || '';
  return { ok: true, user };
}

export function currentHandle() { return handle; }
export function setHandle(value) { handle = value || ''; }

// Handle redirect result from Google sign-in (called on page load after redirect)
export async function handleRedirectResult() {
  const auth = getAuth();
  if (!auth) return null;
  try {
    const result = await auth.getRedirectResult();
    if (result && result.user) {
      const fbUser = result.user;
      // Create/update Firestore profile from Google data
      const profData = {
        username: fbUser.displayName || fbUser.email?.split('@')[0] || '',
        full_name: fbUser.displayName || '',
        avatar_url: fbUser.photoURL || '',
      };
      await setProfile(fbUser.uid, profData);

      const user = await buildUserObj(fbUser);
      handle = user?.user_metadata?.username || '';
      console.log('[GlitchIt] Google redirect sign-in successful');
      return user;
    }
  } catch (err) {
    console.error('[GlitchIt] getRedirectResult error:', err);
  }
  return null;
}

export function userHandle(user) {
  if (!user) return '';
  return user.user_metadata?.username || user.email?.split('@')[0] || user.id || '';
}

// ─── Error formatting ──────────────────────────────────────────────

function formatError(error) {
  const code = error?.code || '';
  const msg = error?.message || '';

  if (code === 'auth/user-not-found' || /user.*not.*found/i.test(msg)) {
    return 'No account found with this email. Please sign up first.';
  }
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || /invalid.*login.*credentials/i.test(msg)) {
    return 'Invalid email or password. Please try again.';
  }
  if (code === 'auth/email-already-in-use' || /already.*registered|already.*exists/i.test(msg)) {
    return 'This email is already registered. Please sign in.';
  }
  if (code === 'auth/weak-password' || /password.*length|password.*short/i.test(msg)) {
    return 'Password must be at least 6 characters.';
  }
  if (code === 'auth/too-many-requests' || /rate.*limit/i.test(msg)) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (/network|fetch|timeout|cors/i.test(msg)) {
    return 'Network error. Please check your internet connection and try again.';
  }

  return msg || 'An unexpected error occurred. Please try again.';
}
