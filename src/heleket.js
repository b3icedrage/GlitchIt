// GlitchIt — Heleket crypto payments (client side).
// The browser never sees the Heleket API key: it calls our same-origin proxy
// (/api/heleket/...) which signs requests server-side. Purchase state is kept
// in localStorage (order pending -> verified once Heleket reports paid) and
// reconciled through /status on later visits, so a paid Verified badge sticks
// across reloads — same pattern as the pro-dashboard stats.

export const HELEKET_PLANS = [
  { id: 'monthly', name: 'Monthly', price: '$9.99', per: 'per month', best: false },
  { id: 'quarterly', name: '3 months', price: '$25.99', per: 'every 3 months', best: false },
  { id: 'yearly', name: 'Yearly', price: '$99.99', per: 'per year', best: true },
];

export function heleketPlans() {
  return HELEKET_PLANS;
}

// ---------------------------------------------------------------------------
// Server proxy calls
// ---------------------------------------------------------------------------
async function proxy(path, payload) {
  try {
    const res = await fetch(`/api/heleket${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    return await res.json().catch(() => ({ ok: false, error: 'Bad response from the payment server.' }));
  } catch (err) {
    return { ok: false, error: 'Could not reach the payment server.' };
  }
}

export function makeOrderId() {
  return `glitchit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Creates a Heleket invoice for a plan; resolves with { ok, url, uuid, order_id }.
export function createInvoice(planId, orderId) {
  return proxy('/create', { plan: planId, order_id: orderId });
}

// Resolves with { ok, paid, status } for an order.
export function checkStatus(orderId) {
  return proxy('/status', { order_id: orderId });
}

// ---------------------------------------------------------------------------
// Local purchase state (pending -> verified)
// ---------------------------------------------------------------------------
const PENDING_KEY = 'glitchit.heleket.pending';
const VERIFIED_KEY = 'glitchit.heleket.verified';

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err) { return null; }
}

export function savePending(orderId, planId) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ orderId, planId, at: Date.now() })); } catch (err) { /* ignore */ }
}
export function readPending() {
  return readJson(PENDING_KEY);
}
export function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch (err) { /* ignore */ }
}

export function saveVerified(orderId, planId) {
  try { localStorage.setItem(VERIFIED_KEY, JSON.stringify({ orderId, planId, at: Date.now() })); } catch (err) { /* ignore */ }
  clearPending();
}
export function readVerified() {
  return readJson(VERIFIED_KEY);
}

// True when the user has a locally recorded, paid Heleket purchase. Also
// reconciles any pending order left behind from an interrupted checkout: if
// Heleket reports it paid, it is promoted to verified on the spot.
export async function isHeleketVerified() {
  if (readVerified()) return true;
  const pending = readPending();
  if (!pending || !pending.orderId) return false;
  try {
    const res = await checkStatus(pending.orderId);
    if (res && res.ok && res.paid) {
      saveVerified(pending.orderId, pending.planId);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}
