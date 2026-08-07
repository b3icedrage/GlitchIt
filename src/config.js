// GlitchIt — Supabase connection config (client-safe public keys).
// The anon key is designed to be public (it ships in every client app).
// Fill these two values in and refresh — the app will then store media
// and saved videos in your Supabase project instead of just localStorage.
export const SUPABASE_URL = 'https://socaxjkikrxantwxacqy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY2F4amtpa3J4YW50d3hhY3F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MTMzNzEsImV4cCI6MjEwMTA4OTM3MX0.wBhxPka_CsqSVTQHjr3DS2ddvw_ezht4NToqTbzGzb4';

// GlitchIt — monitoring. Paste your public Sentry DSN here to enable error
// tracking + performance monitoring. A DSN is a public client key (safe to ship
// in the browser, like the anon key above). Empty string = monitoring off.
export const SENTRY_DSN = '';
