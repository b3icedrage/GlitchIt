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


