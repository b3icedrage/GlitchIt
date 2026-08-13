// GlitchIt — billing: Heleket (crypto, primary) + RevenueCat (cards, fallback).
// Loaded from main.js via dynamic import, same pattern as auth.js/db.js.
//
// Payments now run through Heleket: the branded paywall sheet creates a Heleket
// invoice (via our /api/heleket proxy, which holds the secret key server-side)
// and the user pays with crypto. RevenueCat remains as the "pay with card"
// option for users who prefer it, and its entitlements still count toward
// GlitchIt Verified. When neither is configured everything degrades gracefully
// (helpers return empty/false) so billing never blocks the rest of the app.
import { REVENUECAT_API_KEY } from './config.js?v=6';
import {
  HELEKET_PLANS,
  createInvoice,
  checkStatus,
  makeOrderId,
  savePending,
  readPending,
  clearPending,
  saveVerified,
  isHeleketVerified,
} from './heleket.js?v=1';

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

// True when the configured RevenueCat key is a sandbox key (test_…). Web
// checkouts in test mode only accept Stripe *test* cards — real cards are
// rejected with a "payment not verified" error. Exposed so the UI can show a
// clear hint instead of a cryptic failure.
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

// Whether the user currently has GlitchIt Verified. Matches the RevenueCat
// entitlement exactly first, then falls back to a whitespace-normalized
// comparison, and finally counts a paid Heleket purchase (local record, or a
// pending order that Heleket now reports as paid).
export async function isPro() {
  const active = await activeEntitlements();
  if (active[PRO_ENTITLEMENT_ID]) return true;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(PRO_ENTITLEMENT_ID);
  if (Object.keys(active).some((k) => norm(k) === target)) return true;
  try {
    if (await isHeleketVerified()) return true;
  } catch (err) { /* billing must never break the app */ }
  return false;
}

// ---------- Branded in-app paywall (Heleket first, cards fallback) ----------
// presentPaywall() opens a GlitchIt-branded plan picker. The primary checkout
// is Heleket crypto (invoice created through /api/heleket, paid in the opened
// Heleket window, verified by polling /status). A "pay with card" link falls
// back to RevenueCat's SDK when a key is configured. If the sheet can't be
// built (no document) it falls back to the hosted RevenueCat paywall.

const RC_PLAN_MAP = { monthly: 'MONTHLY', quarterly: 'THREE_MONTH', yearly: 'ANNUAL' };
const RC_BEST_PLAN = 'yearly';

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
        <div class="paywall-alt" id="paywall-alt" hidden>
          <button type="button" id="paywall-card">Pay with card instead</button>
        </div>
        <button type="button" class="paywall-restore" id="paywall-restore">Restore purchase</button>
        <p class="paywall-legal">Subscriptions auto-renew until cancelled. Crypto payments are processed by Heleket; card payments by RevenueCat.</p>
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
//   { ok: true }              -> purchase completed and Verified is active
//   { ok: false, reason }     -> purchase attempted but not verified yet
//   null                      -> dismissed (or checkout cancelled)
//   undefined                 -> sheet could not be built (caller falls back)
async function showBrandedPaywall(instance) {
  if (typeof document === 'undefined' || !document.body) return undefined;
  const root = paywallEls();
  const plansEl = root.querySelector('#paywall-plans');
  const cta = root.querySelector('#paywall-cta');
  const alt = root.querySelector('#paywall-alt');
  const cardBtn = root.querySelector('#paywall-card');
  const restore = root.querySelector('#paywall-restore');
  const error = root.querySelector('#paywall-error');
  const legal = root.querySelector('.paywall-legal');

  // Fresh state for this open.
  error.hidden = true;
  alt.hidden = !rcAvailable();
  legal.textContent = 'Subscriptions auto-renew until cancelled. Crypto payments are processed by Heleket; card payments by RevenueCat.';
  root.querySelectorAll('.paywall-test-hint').forEach((el) => el.remove());

  const plans = HELEKET_PLANS;
  let selected = plans.findIndex((p) => p.best);
  if (selected < 0) selected = 0;
  let busy = false;
  let pollTimer = null;
  let settled = false;

  const settleOnce = (result) => {
    if (settled) return;
    settled = true;
    settlePaywall(root, result);
  };
  const fail = (message) => { error.textContent = message; error.hidden = false; };
  const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

  const showPlans = () => {
    plansEl.innerHTML = plans.map((p, i) => `
      <button type="button" class="paywall-plan${p.best ? ' best' : ''}" data-plan="${i}" role="radio" aria-checked="${i === selected}">
        ${p.best ? '<em class="paywall-plan-tag">Best value</em>' : ''}
        <span class="paywall-plan-name">${escHtml(p.name)}</span>
        <span class="paywall-plan-price">${escHtml(p.price)}</span>
        <span class="paywall-plan-per">${escHtml(p.per)}</span>
      </button>`).join('');
    plansEl.querySelectorAll('.paywall-plan').forEach((el) => {
      el.addEventListener('click', () => {
        selected = Number(el.dataset.plan);
        plansEl.querySelectorAll('.paywall-plan').forEach((x, i) => x.setAttribute('aria-checked', String(i === selected)));
        [...plansEl.children].forEach((x, i) => x.classList.toggle('selected', i === selected));
      });
    });
    [...plansEl.children].forEach((x, i) => x.classList.toggle('selected', i === selected));
    cta.textContent = 'Pay with crypto';
    cta.disabled = false;
    cta.onclick = () => runHeleket(plans[selected].id);
    alt.hidden = !rcAvailable();
    cardBtn.onclick = () => runRc(plans[selected].id);
  };

  const showWaiting = (orderId, planId) => {
    plansEl.innerHTML = `
      <div class="paywall-waiting">
        <span class="paywall-spinner" aria-hidden="true"></span>
        <b>Waiting for payment</b>
        <p>Complete the payment in the opened Heleket window. Your GlitchIt Verified badge activates automatically once the network confirms the payment.</p>
        <button type="button" class="paywall-check" id="paywall-check">Check payment status</button>
      </div>`;
    cta.textContent = 'Checking…';
    cta.disabled = true;
    alt.hidden = true;
    const check = async () => {
      if (busy) return;
      busy = true;
      cta.disabled = true;
      error.hidden = true;
      try {
        const res = await checkStatus(orderId);
        if (res && res.ok && res.paid) {
          saveVerified(orderId, planId);
          stopPolling();
          finishPro();
          return;
        }
        if (res && res.ok && ['fail', 'cancel', 'system_fail'].includes(res.status)) {
          clearPending();
          stopPolling();
          fail('Payment was not completed — you can try again.');
          showPlans();
          return;
        }
        if (!res.ok && res.error) fail(res.error);
      } catch (err) {
        fail('Could not check the payment — try again in a moment.');
      } finally {
        busy = false;
        cta.disabled = true;
      }
    };
    document.getElementById('paywall-check')?.addEventListener('click', check);
    // Auto-check every 4s while the payment is pending (crypto confirmations
    // can take a couple of minutes); the button above resumes after a pause.
    stopPolling();
    pollTimer = setInterval(check, 4000);
  };

  const finishPro = () => {
    stopPolling();
    settleOnce({ ok: true });
    closePaywall(root);
  };

  // --- Heleket (primary): create an invoice, open the payment window, poll ---
  const runHeleket = async (planId) => {
    if (busy) return;
    busy = true;
    cta.disabled = true;
    const original = cta.textContent;
    cta.textContent = 'Opening payment…';
    error.hidden = true;
    let orderId = (readPending() && readPending().orderId) || makeOrderId();
    savePending(orderId, planId);
    try {
      const res = await createInvoice(planId, orderId);
      if (!res.ok) {
        // Heleket isn't wired up (no key/merchant on the server) — point the
        // user at the card fallback instead of leaving them stuck.
        fail(res.error || 'Crypto payments are not available right now.');
        showPlans();
        return;
      }
      if (res.url) window.open(res.url, '_blank', 'noopener');
      showWaiting(orderId, planId);
    } catch (err) {
      fail('Could not create the payment — try again.');
      showPlans();
    } finally {
      busy = false;
      cta.textContent = original;
    }
  };

  // --- RevenueCat (fallback): card checkout for the chosen plan ---
  const runRc = async (planId) => {
    if (busy) return;
    busy = true;
    cta.disabled = true;
    const original = cta.textContent;
    cta.textContent = 'Opening card payment…';
    error.hidden = true;
    try {
      const offerings = await instance.getOfferings();
      const current = offerings && offerings.current;
      const packages = (current && current.availablePackages) || [];
      const wanted = RC_PLAN_MAP[planId];
      const pkg = packages.find((p) => String(p.packageType).toUpperCase() === wanted) || packages[0];
      if (pkg) await instance.purchasePackage(pkg);
      else await instance.presentPaywall(); // hosted RevenueCat checkout
      const pro = await isPro();
      if (pro) { finishPro(); return; }
      fail(rcTestMode()
        ? 'Payment not verified — test mode only accepts Stripe test cards (4242 4242 4242 4242). Real cards are rejected.'
        : 'Payment not verified — please try again in a moment.');
      settleOnce({ ok: false, reason: 'not-verified' });
    } catch (err) {
      const message = (err && err.message) || '';
      if (/cancel/i.test(message)) settleOnce(null);
      else { fail('Couldn’t complete the payment — try again.'); settleOnce({ ok: false, reason: 'error' }); }
    } finally {
      busy = false;
      cta.textContent = original;
      showPlans();
      cta.disabled = false;
      cta.onclick = () => runHeleket(plans[selected].id);
      alt.hidden = !rcAvailable();
      cardBtn.onclick = () => runRc(plans[selected].id);
    }
  };

  restore.onclick = async () => {
    if (busy) return;
    busy = true;
    restore.disabled = true;
    error.hidden = true;
    try {
      const pro = await isPro();
      if (pro) { finishPro(); return; }
      fail('No active purchase found on this account.');
    } catch (err) {
      fail('Couldn’t check your purchase — try again.');
    } finally {
      busy = false;
      restore.disabled = false;
    }
  };

  root._settle = null;
  settled = false;
  // Resume an interrupted checkout if one is pending.
  const pending = readPending();
  if (pending && pending.orderId) {
    showWaiting(pending.orderId, pending.planId || 'monthly');
  } else {
    showPlans();
  }
  root.classList.add('open');
  return new Promise((resolve) => { root._settle = resolve; });
}

// Present the paywall for the current offering. Opens the branded GlitchIt
// paywall sheet (Heleket crypto first, RevenueCat cards as a fallback); falls
// back to the hosted RevenueCat paywall when the sheet can't be built. Resolves
// with the purchase outcome ({ ok, reason }), null when the user dismisses, or
// rejects when the offering itself is missing.
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
