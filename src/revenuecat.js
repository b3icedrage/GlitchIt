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

// True when the configured key is a RevenueCat sandbox key (test_…). Web
// checkouts in test mode only accept Stripe *test* cards — real cards are
// rejected with a "payment not verified" error, which is the #1 cause of
// failed purchases during development. Exposed so the UI can show a clear
// hint instead of a cryptic failure.
export function rcTestMode() {
  return /^test_/i.test(String(REVENUECAT_API_KEY || ''));
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

// ---------- Branded in-app paywall (the "payment page") ----------
// presentPaywall() now opens a GlitchIt-branded plan picker instead of the
// hosted RevenueCat paywall. Plans and prices are loaded from the real
// RevenueCat offering, and the purchase itself still runs through the SDK
// (purchasePackage), so nothing about billing is faked. If the sheet can't be
// built (no document) it falls back to the hosted paywall.

const RC_PLAN_ORDER = ['WEEKLY', 'MONTHLY', 'TWO_MONTH', 'THREE_MONTH', 'SIX_MONTH', 'ANNUAL', 'LIFETIME'];
const RC_PLAN_LABEL = {
  WEEKLY: 'Weekly', MONTHLY: 'Monthly', TWO_MONTH: '2 months', THREE_MONTH: '3 months',
  SIX_MONTH: '6 months', ANNUAL: 'Yearly', LIFETIME: 'Lifetime',
};
const RC_PLAN_PER = {
  WEEKLY: 'per week', MONTHLY: 'per month', TWO_MONTH: 'every 2 months', THREE_MONTH: 'every 3 months',
  SIX_MONTH: 'every 6 months', ANNUAL: 'per year', LIFETIME: 'one-time',
};
const RC_BEST_PLAN = 'ANNUAL';

function escHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function paywallSheetHtml() {
  return `
    <div class="paywall-backdrop" id="paywall-backdrop">
      <section class="paywall-sheet" role="dialog" aria-modal="true" aria-label="GlitchIt Verified">
        <button type="button" class="paywall-close" data-paywall-close aria-label="Close">×</button>
        <div class="paywall-hero">
          <span class="paywall-mark" aria-hidden="true">⚡</span>
          <span class="paywall-eyebrow">GlitchIt Pro</span>
          <h2>Get GlitchIt Verified</h2>
          <p>Unlock the full GlitchIt experience — premium tools, more of everything, and zero ads.</p>
        </div>
        <div class="paywall-plans" id="paywall-plans" role="radiogroup" aria-label="Plans"></div>
        <button type="button" class="paywall-cta" id="paywall-cta">Loading plans…</button>
        <button type="button" class="paywall-restore" id="paywall-restore">Restore purchase</button>
        <p class="paywall-legal">Subscriptions auto-renew until cancelled. Cancel anytime from your RevenueCat dashboard.</p>
        <p class="paywall-error" id="paywall-error" role="alert" hidden></p>
      </section>
    </div>`;
}

// Lazy-build the sheet once; every open reuses the same DOM.
function paywallEls() {
  let root = document.getElementById('paywall-backdrop');
  if (root) return root;
  document.body.insertAdjacentHTML('beforeend', paywallSheetHtml());
  root = document.getElementById('paywall-backdrop');
  const dismiss = () => { settlePaywall(root, null); closePaywall(root); };
  root.querySelector('[data-paywall-close]').addEventListener('click', dismiss);
  root.addEventListener('click', (event) => { if (event.target === root) dismiss(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const el = document.getElementById('paywall-backdrop');
    if (el && el.classList.contains('open')) { settlePaywall(el, null); closePaywall(el); }
  });
  return root;
}

function closePaywall(root) {
  if (!root) return;
  root.classList.remove('open');
}

function settlePaywall(root, result) {
  if (!root) return;
  const settle = root._settle;
  root._settle = null;
  if (settle) settle(result);
}

// Renders the plan picker and waits for the user. Resolves with:
//   { ok: true }              -> purchase completed and entitlement is active
//   { ok: false, reason }     -> purchase attempted but not verified yet
//   null                      -> dismissed (or checkout cancelled)
//   undefined                 -> sheet could not be built (caller falls back)
async function showBrandedPaywall(instance) {
  if (typeof document === 'undefined' || !document.body) return undefined;
  const root = paywallEls();
  const plansEl = root.querySelector('#paywall-plans');
  const cta = root.querySelector('#paywall-cta');
  const restore = root.querySelector('#paywall-restore');
  const error = root.querySelector('#paywall-error');

  // Fresh state for this open.
  error.hidden = true;
  root.querySelectorAll('.paywall-test-hint').forEach((el) => el.remove());

  // Load real plans from the RevenueCat offering (defensive: no SDK/key -> []).
  let packages = [];
  try {
    const offerings = await instance.getOfferings();
    const current = offerings && offerings.current;
    packages = (current && current.availablePackages) || [];
  } catch (err) { packages = []; }
  packages = packages
    .map((p) => ({
      pkg: p,
      type: String((p && p.packageType) || 'UNKNOWN').toUpperCase(),
      name: (p.product && p.product.title) || '',
      price: (p.product && p.product.priceString) || '',
      intro: (p.product && p.product.introPrice && p.product.introPrice.priceString) || '',
    }))
    .sort((a, b) => {
      const ia = RC_PLAN_ORDER.indexOf(a.type);
      const ib = RC_PLAN_ORDER.indexOf(b.type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  let selected = -1;
  let busy = false;
  const select = (index) => {
    selected = index;
    [...plansEl.children].forEach((el, i) => el.classList.toggle('selected', i === index));
    cta.disabled = selected < 0 || busy;
  };
  const fail = (message) => { error.textContent = message; error.hidden = false; };

  if (packages.length) {
    plansEl.innerHTML = packages.map((p, i) => `
      <button type="button" class="paywall-plan${p.type === RC_BEST_PLAN ? ' best' : ''}" data-plan="${i}" role="radio" aria-checked="false">
        ${p.type === RC_BEST_PLAN ? '<em class="paywall-plan-tag">Best value</em>' : ''}
        <span class="paywall-plan-name">${escHtml(RC_PLAN_LABEL[p.type] || p.name || p.type.toLowerCase())}</span>
        <span class="paywall-plan-price">${p.intro ? `<i>${escHtml(p.intro)}</i>` : ''}${escHtml(p.price)}</span>
        <span class="paywall-plan-per">${escHtml(RC_PLAN_PER[p.type] || '')}</span>
      </button>`).join('');
    plansEl.querySelectorAll('.paywall-plan').forEach((el) => {
      el.addEventListener('click', () => {
        plansEl.querySelectorAll('.paywall-plan').forEach((x, i) => x.setAttribute('aria-checked', String(i === Number(el.dataset.plan))));
        select(Number(el.dataset.plan));
      });
    });
    const best = packages.findIndex((p) => p.type === RC_BEST_PLAN);
    select(best >= 0 ? best : 0);
    cta.textContent = 'Get GlitchIt Verified';
  } else {
    plansEl.innerHTML = '<div class="paywall-plans-empty"><span aria-hidden="true">✦</span><p>Plans aren’t available right now — open the RevenueCat checkout to subscribe.</p></div>';
    cta.textContent = 'Open RevenueCat checkout';
    cta.disabled = false;
  }

  const testMode = rcTestMode();
  if (testMode) {
    root.querySelector('.paywall-legal').insertAdjacentHTML('beforebegin', '<p class="paywall-test-hint">Test mode: only Stripe test cards work — 4242 4242 4242 4242</p>');
  }

  const purchase = async () => {
    if (busy) return;
    busy = true;
    cta.disabled = true;
    const original = cta.textContent;
    cta.textContent = 'Processing…';
    error.hidden = true;
    try {
      if (packages.length && selected >= 0) await instance.purchasePackage(packages[selected].pkg);
      else await instance.presentPaywall(); // hosted fallback checkout
      const pro = await isPro();
      if (pro) {
        closePaywall(root);
        settlePaywall(root, { ok: true });
        return;
      }
      fail(testMode
        ? 'Payment not verified — test mode only accepts Stripe test cards (4242 4242 4242 4242). Real cards are rejected.'
        : 'Payment not verified — please try again in a moment.');
      settlePaywall(root, { ok: false, reason: 'not-verified' });
    } catch (err) {
      const message = (err && err.message) || '';
      if (/cancel/i.test(message)) settlePaywall(root, null);
      else { fail('Couldn’t complete the payment — try again.'); settlePaywall(root, { ok: false, reason: 'error' }); }
    } finally {
      busy = false;
      cta.textContent = original;
      cta.disabled = packages.length ? selected < 0 : false;
    }
  };

  restore.onclick = async () => {
    if (busy) return;
    busy = true;
    restore.disabled = true;
    error.hidden = true;
    try {
      const pro = await isPro();
      if (pro) {
        closePaywall(root);
        settlePaywall(root, { ok: true });
        return;
      }
      fail('No active purchase found on this account.');
    } catch (err) {
      fail('Couldn’t check your purchase — try again.');
    } finally {
      busy = false;
      restore.disabled = false;
    }
  };

  cta.onclick = purchase;
  root._settle = null;
  root.classList.add('open');
  return new Promise((resolve) => { root._settle = resolve; });
}

// Present RevenueCat's paywall for the current offering. Opens the branded
// GlitchIt paywall sheet when possible (it auto-fills real plans/prices from
// the offering and completes the purchase through the SDK); otherwise falls
// back to the hosted RevenueCat paywall. Resolves with the purchase outcome
// ({ ok, reason }), null when the user dismisses, or rejects when the offering
// itself is missing.
export async function presentPaywall(opts = {}) {
  const p = await getInstance();
  if (!p) return null;
  try {
    const outcome = await showBrandedPaywall(p);
    if (outcome !== undefined) return outcome;
  } catch (err) {
    console.warn('GlitchIt: branded paywall unavailable, falling back to hosted', err);
  }
  const offering = opts.offering || (await p.getOfferings()).current;
  if (!offering) throw new Error('No offering available');
  return await p.presentPaywall({ offering, ...opts });
}

// Purchase a specific package directly (opens RevenueCat's checkout UI).
export async function purchasePackage(pkg) {
  const p = await getInstance();
  if (!p) return null;
  return await p.purchasePackage(pkg);
}

// SDK helper: is the user entitled to the given entitlement id?
export async function isEntitledTo(id) {
  const p = await getInstance();
  if (!p) return false;
  try {
    return await p.isEntitledTo(id);
  } catch (err) {
    console.warn('GlitchIt: isEntitledTo failed', err);
    return false;
  }
}
