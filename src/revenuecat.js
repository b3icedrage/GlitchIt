// GlitchIt — RevenueCat subscriptions (client-side, no build step).
// Loaded from main.js via dynamic import, same pattern as auth.js/db.js.
// The API key is RevenueCat's public *web* key — it is designed to ship in the
// browser (like the Supabase anon key) and identifies your app; it is not a
// secret. When the key is empty or the CDN is unreachable, everything here
// degrades gracefully (helpers return empty/false) so billing never blocks
// the rest of the app.
import { REVENUECAT_API_KEY } from './config.js?v=6';

let purchases = null;
let purchasesPromise = null;

// Try several CDNs so one blocked/unreachable mirror (ad-blocker, region, etc.)
// doesn't take down subscriptions. First one that loads wins.
const REVENUECAT_CDNS = [
  'https://cdn.jsdelivr.net/npm/@revenuecat/purchases-js@1/+esm',
  'https://esm.sh/@revenuecat/purchases-js@1',
  'https://unpkg.com/@revenuecat/purchases-js@1?module',
];

async function importRevenueCat() {
  let lastErr = null;
  for (const url of REVENUECAT_CDNS) {
    try {
      return await import(url);
    } catch (err) {
      lastErr = err;
      console.warn(`GlitchIt: purchases-js unavailable from ${url}`, err);
    }
  }
  throw lastErr || new Error('All RevenueCat CDNs unreachable');
}

// Anonymous users get a stable app user id: generated once, stored in
// localStorage so entitlements survive reloads and sessions.
const ANON_ID_KEY = 'glitchit.rc.anonymousId';

export function rcAvailable() {
  return Boolean(REVENUECAT_API_KEY);
}

// Configure once (per page load) and return the shared instance.
// Pass the signed-in account id (e.g. the Supabase user id) when available so
// entitlements follow the account; otherwise a persisted anonymous id is used.
export async function initRevenueCat(appUserId) {
  if (!REVENUECAT_API_KEY) return null;
  if (purchasesPromise) return purchasesPromise;
  purchasesPromise = (async () => {
    const { Purchases } = await importRevenueCat();
    let userId = typeof appUserId === 'string' && appUserId ? appUserId : null;
    if (!userId) {
      try { userId = localStorage.getItem(ANON_ID_KEY); } catch (err) { userId = null; }
    }
    if (!userId) {
      userId = Purchases.generateRevenueCatAnonymousAppUserId();
      try { localStorage.setItem(ANON_ID_KEY, userId); } catch (err) { /* ignore */ }
    }
    purchases = Purchases.configure({ apiKey: REVENUECAT_API_KEY, appUserId: userId });
    return purchases;
  })();
  return purchasesPromise;
}

async function getInstance() {
  try {
    return await (purchasesPromise || initRevenueCat());
  } catch (err) {
    console.warn('GlitchIt: RevenueCat unavailable', err);
    return null;
  }
}

export async function getAppUserId() {
  const p = await getInstance();
  return p ? p.appUserId : null;
}

// Map of currently active entitlements, e.g. { pro: { ... } }.
export async function activeEntitlements() {
  const p = await getInstance();
  if (!p) return {};
  try {
    const info = await p.getCustomerInfo();
    return info.entitlements.active || {};
  } catch (err) {
    console.warn('GlitchIt: getCustomerInfo failed', err);
    return {};
  }
}

// Convenience check for a specific entitlement (e.g. 'pro').
export async function hasEntitlement(id) {
  const active = await activeEntitlements();
  return Boolean(id && active[id]);
}

// The app's configured packages/offerings, for building a paywall.
export async function getOfferings() {
  const p = await getInstance();
  if (!p) return null;
  try {
    return await p.getOfferings();
  } catch (err) {
    console.warn('GlitchIt: getOfferings failed', err);
    return null;
  }
}

// The entitlement id as configured in the RevenueCat dashboard.
export const PRO_ENTITLEMENT_ID = 'GlitchIt  Pro';

// Whether the user currently has the GlitchIt Pro entitlement. Matches the
// exact id first, then falls back to a whitespace-normalized comparison in
// case the dashboard id differs only in spacing/case.
export async function isPro() {
  const active = await activeEntitlements();
  if (active[PRO_ENTITLEMENT_ID]) return true;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(PRO_ENTITLEMENT_ID);
  return Object.keys(active).some((k) => norm(k) === target);
}
