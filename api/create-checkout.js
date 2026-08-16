// GlitchIt — POST /api/create-checkout: create a Stripe Checkout session for
// the GlitchIt Premium subscription (monthly $4.99 / yearly $39.99).
// The browser POSTs { plan, email?, userId? } and gets back { ok, url } — the
// app redirects the user to Stripe's hosted checkout, so the card form and
// recurring billing never touch our servers. The secret key lives server-side
// only (Vercel → Project Settings → Environment Variables, and .env.local for
// the preview). Works as a Vercel serverless function AND from server.js.
//
// Required env vars:
//   STRIPE_SECRET_KEY - from Stripe → Developers → API keys (sk_live_...)
//
// When the key is missing the endpoint reports { ok:false, error:'not configured' }
// and the premium page shows a friendly "almost ready" message instead of
// breaking the buttons.
'use strict';

const STRIPE_API = 'https://api.stripe.com/v1';
const BODY_MAX = 16 * 1024;

const PLANS = {
  monthly: { name: 'GlitchIt Premium — Monthly', amount: 499, interval: 'month' },
  yearly: { name: 'GlitchIt Premium — Yearly', amount: 3999, interval: 'year' },
};

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  if (!secretKey) {
    json(res, 200, { ok: false, error: 'not configured' });
    return;
  }

  const body = await readJsonBody(req, BODY_MAX);
  const plan = body && body.plan === 'yearly' ? 'yearly' : 'monthly';
  const planDef = PLANS[plan];

  // Success/cancel URLs must be absolute; derive the origin from the request
  // (works on Vercel and the local preview alike).
  const host = (req.headers && req.headers.host) || 'localhost:4173';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const base = `${proto}://${host}`;

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', `${base}/premium.html?success=1`);
  params.set('cancel_url', `${base}/premium.html?canceled=1`);
  params.set('client_reference_id', String(body && body.userId ? body.userId : ''));
  if (body && typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    params.set('customer_email', body.email);
  }
  params.set('metadata[app]', 'glitchit');
  params.set('metadata[plan]', plan);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(planDef.amount));
  params.set('line_items[0][price_data][product_data][name]', planDef.name);
  params.set('line_items[0][price_data][recurring][interval]', planDef.interval);

  let data = null;
  try {
    const r = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.url) {
      const detail = (data && (data.error && data.error.message)) || `Stripe error (${r.status})`;
      console.warn('GlitchIt: Stripe checkout failed', detail);
      json(res, 502, { ok: false, error: 'Could not start checkout. Please try again in a moment.' });
      return;
    }
  } catch (err) {
    console.warn('GlitchIt: Stripe checkout unreachable', err);
    json(res, 502, { ok: false, error: 'Could not reach the payment service right now.' });
    return;
  }

  json(res, 200, { ok: true, url: data.url, plan });
};
