// GlitchIt — Firebase config (client-safe public keys).
// Firebase is used for auth + Firestore for user profiles.
// These values are safe to ship in the client bundle.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBVjt-uis7rUfh4LSHnQxwA8otA13Oj_-M',
  authDomain: 'glitchit-749c0.firebaseapp.com',
  databaseURL: 'https://glitchit-749c0-default-rtdb.firebaseio.com',
  projectId: 'glitchit-749c0',
  storageBucket: 'glitchit-749c0.firebasestorage.app',
  messagingSenderId: '528294753215',
  appId: '1:528294753215:web:bc433d9d173c0b95b4670a',
  measurementId: 'G-75V7YGZ9C5',
};
// Legacy Supabase exports (empty — no longer used)
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// GlitchIt — media storage (Cloudinary, free tier). Browser-direct uploads use
// an *unsigned* upload preset, so these two values are NOT secrets — they ship
// in every client exactly like the Supabase anon key above. 100 MB per file,
// 25 GB free storage + bandwidth, CDN delivery for the feed.
// Setup (one-time, ~2 min):
//   1. Create a free account at https://cloudinary.com → your Cloud name is
//      shown in the dashboard (and in your URL: res.cloudinary.com/<CLOUD_NAME>).
//   2. Settings → Upload → “Add upload preset” → set Signing mode: **Unsigned**
//      → (optional) Folder: glitchit → Save, then copy the preset name.
//   3. Paste both values below. Leave CLOUDINARY_UPLOAD_PRESET as '' to keep
//      using Supabase Storage instead.
export const CLOUDINARY_CLOUD_NAME = 'cyv96uet';
export const CLOUDINARY_UPLOAD_PRESET = 'glitchit';

// GlitchIt — monitoring. Public Sentry DSN (a client key, safe to ship in the
// browser like the anon key above) enabling error tracking + performance
// monitoring. Set to '' to turn monitoring off.
export const SENTRY_DSN = 'https://939ccfce91ed2bac818479f05a2ff492@o4511871344508928.ingest.us.sentry.io/4511871351980032';


// GlitchIt — API base for the server proxies (/api/chat, /api/music,
// /api/nvidia-video, /api/livekit-token, /api/accounts).
//   - Website: ''  → same origin (the server serves both the site and /api).
//   - Native APK: the app is bundled inside the APK (no website), so these
//     proxies live on a backend — set this to that backend's origin, e.g.
//     'https://your-backend.example.com'. The app also honors a localStorage
//     override ('glitchit.apiBase') so you can point it at a server without
//     rebuilding, and exposes the resolved value as window.GLITCHIT_API_BASE
//     for the classic scripts (ai-chat, music-ui, calls, …) that can't import
//     ES modules.
export const API_BASE = (() => {
  // In the native APK there is no local server — all API endpoints live on
  // the production origin.  Capacitor sets window.Capacitor (or
  // window.nativebridgetest on older builds) when running inside the bridge;
  // detect that and default to the production URL.
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform);
  const nativeDefault = isNative ? 'https://glitchit.app' : '';
  try {
    const override = localStorage.getItem('glitchit.apiBase');
    if (override) return override.replace(/\/+$/, '');
  } catch (err) { /* storage unavailable */ }
  return nativeDefault;
})();
try { window.GLITCHIT_API_BASE = API_BASE; } catch (err) { /* ignore */ }

