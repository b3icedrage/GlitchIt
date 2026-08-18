// GlitchIt — Supabase connection config (client-safe public keys).
// The anon key is designed to be public (it ships in every client app).
// Fill these two values in and refresh — the app will then store media
// and saved videos in your Supabase project instead of just localStorage.
export const SUPABASE_URL = 'https://socaxjkikrxantwxacqy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY2F4amtpa3J4YW50d3hhY3F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MTMzNzEsImV4cCI6MjEwMTA4OTM3MX0.wBhxPka_CsqSVTQHjr3DS2ddvw_ezht4NToqTbzGzb4';

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

// GlitchIt — Flutterwave payments (pan-African: cards, mobile money, bank
// transfer, USSD). The public key is client-safe (same rule as the Supabase
// anon key) and powers the standard checkout popup for shop drops (KES) and
// GlitchIt Premium (USD). The secret key (FLWSECK_*) stays server-side only
// (env var FLUTTERWAVE_SECRET_KEY, never shipped to the browser) for future
// webhook / transaction verification work.
export const FLUTTERWAVE_PUBLIC_KEY = 'FLWPUBK_TEST-fd61af2bf519d47f573c72aa742f19c7-X';
export const FLUTTERWAVE_ENV = 'test'; // set 'live' when you swap in live keys

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

