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

// GlitchIt — subscriptions (RevenueCat). Public *web* API key — designed to
// ship in the browser like the Supabase anon key (it identifies your app, not
// a secret). Set to '' to turn billing off. Test keys (test_…) work against
// RevenueCat's sandbox; swap in your production key when you go live.
export const REVENUECAT_API_KEY = 'test_ptQnnsUijXxVUzEytwLiwoGITDQ';

// GlitchIt — IntaSend payments (Kenya: M-Pesa + cards, payouts to Kenyan banks).
// The publishable key is client-safe (same rule as the Supabase anon key) and
// powers the inline checkout. The secret key stays server-side only (env vars,
// never shipped to the browser) for future webhook/verification work.
export const INTASEND_PUBLIC_KEY = 'ISPubKey_test_107a363e-ffcd-42a9-ba74-02af95f60914';
export const INTASEND_LIVE = false; // set true when you swap in a live key
