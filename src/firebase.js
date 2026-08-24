// GlitchIt — Firebase initialization + Analytics + Google Auth
// Loads Firebase compat SDK from CDN (already in HTML pages) and initializes it
// with the config from config.js. This module is loaded via dynamic import() from main.js.

/* global gtag, firebase */
import { FIREBASE_CONFIG } from './config.js?v=6';

const FIREBASE_measurementId = FIREBASE_CONFIG.measurementId;
let initialized = false;

// ─── Initialize Firebase ───────────────────────────────────────────

function ensureInit() {
  if (initialized) return true;
  if (typeof firebase === 'undefined' || !firebase.initializeApp) return false;
  try {
    // Only initialize if not already initialized
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    initialized = true;
    return true;
  } catch (e) {
    console.warn('[GlitchIt] Firebase init error:', e.message);
    return false;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/** True if Firebase Auth is available. */
export function firebaseReady() {
  return ensureInit() && !!firebase.auth;
}

// ─── Analytics ─────────────────────────────────────────────────────

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

/** Fire a custom GA4 event. */
export function trackEvent(eventName, params) {
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', eventName, { app_name: 'GlitchIt', ...params });
  } catch (_) { /* ignore */ }
}

// ─── Google Sign-In (Firebase Auth) ───────────────────────────────

/**
 * Sign in with Google using Firebase Auth's popup flow.
 * Returns { ok: true, user } or { ok: false, error: string }.
 */
export async function signInWithGoogle() {
  if (!firebaseReady()) return { ok: false, error: 'Firebase not loaded.' };
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    const result = await firebase.auth().signInWithPopup(provider);
    const fbUser = result.user;

    // Set GA4 user ID
    if (typeof gtag === 'function') gtag('set', { user_id: fbUser.uid });
    trackEvent('login', { method: 'google', user_id: fbUser.uid });

    return {
      ok: true,
      user: {
        id: fbUser.uid,
        email: fbUser.email || '',
        user_metadata: {
          username: fbUser.displayName || (fbUser.email || '').split('@')[0],
          full_name: fbUser.displayName || '',
          avatar_url: fbUser.photoURL || '',
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
