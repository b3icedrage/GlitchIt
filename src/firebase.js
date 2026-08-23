// GlitchIt — Firebase Analytics + Auth (alongside Supabase).
// Requires two <script> tags in <head> before main.js loads:
//   1. gtag.js (Google Analytics 4) — measurementId: G-75V7YGZ9C5
//   2. Firebase compat SDK (firebase-app-compat + firebase-auth-compat)
//
// This module is loaded via dynamic import() from main.js, the same
// pattern as auth.js and db.js.

/* global gtag, firebase */

const FIREBASE_measurementId = 'G-75V7YGZ9C5';
const FIREBASE_projectId = 'glitchit-749c0';

// ---------- helpers ----------

/** True if both gtag (Analytics) and firebase.auth (Auth) are available. */
export function firebaseReady() {
  return !!(typeof gtag === 'function' && typeof firebase !== 'undefined' && firebase.auth);
}

// ---------- Analytics ----------

/** Fire a GA4 page_view event (called once per navigation). */
export function trackPageView(pageName) {
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', 'page_view', {
      page_title: `GlitchIt · ${pageName}`,
      page_location: location.href,
      app_name: 'GlitchIt',
    });
  } catch (_) { /* gtag not loaded or blocked — ignore */ }
}

/** Fire a custom GA4 event (login, sign_up, post_created, etc.). */
export function trackEvent(eventName, params) {
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', eventName, { app_name: 'GlitchIt', ...params });
  } catch (_) { /* ignore */ }
}

// ---------- Auth (mirror to Firebase alongside Supabase) ----------

/**
 * Mirror a Supabase sign-up to Firebase Auth so the user also exists
 * in Firebase for future analytics user-ID tagging or push notifications.
 * Silently succeeds — never blocks or replaces Supabase auth.
 */
export async function mirrorSignUp(email, password) {
  if (!firebaseReady()) return;
  try {
    await firebase.auth().createUserWithEmailAndPassword(email, password);
    const uid = firebase.auth().currentUser?.uid;
    if (uid) trackEvent('sign_up', { method: 'email', user_id: uid });
  } catch (err) {
    // Firebase may reject if the user already exists — that's fine,
    // just fall through to mirrorSignIn so the session is available.
    console.debug('GlitchIt: Firebase mirrorSignUp skipped —', err?.code);
  }
}

/**
 * Mirror a Supabase sign-in to Firebase Auth so GA4 can attribute
 * events to the same user. Silently succeeds on any Firebase error.
 */
export async function mirrorSignIn(email, password) {
  if (!firebaseReady()) return;
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
    const uid = firebase.auth().currentUser?.uid;
    if (uid) {
      // Set GA4 user ID for cross-session attribution
      if (typeof gtag === 'function') gtag('set', { user_id: uid });
      trackEvent('login', { method: 'email', user_id: uid });
    }
  } catch (err) {
    console.debug('GlitchIt: Firebase mirrorSignIn skipped —', err?.code);
  }
}



// ---------- Google Sign-In (Firebase Auth) ----------

/**
 * Sign in with Google using Firebase Auth's popup flow.
 * Returns { ok: true, user: firebaseUser } or { ok: false, error: string }.
 */
export async function signInWithGoogle() {
  if (!firebaseReady()) return { ok: false, error: 'Firebase not loaded.' };
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    const result = await firebase.auth().signInWithPopup(provider);
    const firebaseUser = result.user;
    const email = firebaseUser.email || '';
    const displayName = firebaseUser.displayName || '';
    const photoURL = firebaseUser.photoURL || '';
    const uid = firebaseUser.uid;

    // Set GA4 user ID
    if (typeof gtag === 'function') gtag('set', { user_id: uid });
    trackEvent('login', { method: 'google', user_id: uid });

    // Return the Firebase user info so the caller can create a Supabase-compatible session
    return {
      ok: true,
      user: {
        id: uid,
        email: email,
        user_metadata: {
          username: displayName || email.split('@')[0],
          full_name: displayName,
          avatar_url: photoURL,
        },
      },
    };
  } catch (err) {
    console.error('[GlitchIt] Firebase Google sign-in error:', err);
    if (err.code === 'auth/popup-closed-by-user') {
      return { ok: false, error: 'Sign-in cancelled.' };
    }
    return { ok: false, error: err.message || 'Google sign-in failed.' };
  }
}

/** Mirror a Supabase sign-out to Firebase Auth. */
export async function mirrorSignOut() {
  if (!firebaseReady()) return;
  try {
    await firebase.auth().signOut();
    if (typeof gtag === 'function') gtag('set', { user_id: null });
  } catch (_) { /* ignore */ }
}
