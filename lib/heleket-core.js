// GlitchIt — Heleket crypto-payment proxy (shared core handler).
// The browser can't sign Heleket requests (MD5 over base64(body) + secret API
// key, which must never ship client-side), so the app calls same-origin
// endpoints and this handler does the signing with the API key + merchant id
// held in server env vars.
//
//   POST /api/heleket/create  { plan, order_id }  -> creates an invoice, returns { url, uuid, order_id }
//   POST /api/heleket/status  { order_id }        -> returns { paid, status, result }
//   POST /api/heleket/webhook                     -> acknowledges Heleket's status callbacks
//
// Required env vars:
//   HELEKET_API_KEY     - your Heleket payment API key
//   HELEKET_MERCHANT_ID - the merchant uuid from your Heleket account
//
// Entry points: api/heleket/[...slug].js (Vercel catch-all), the Netlify
// adapter (netlify/functions/heleket.js) and server.js (local/preview).
'use strict';

const crypto = require('node:crypto');

const HELEKET_BASE = 'https://api.heleket.com/v1';

// The GlitchIt Verified plans sold through the crypto paywall. Amounts are USD
// invoice amounts (Heleket swaps them to the payer's chosen crypto at checkout).
// Keep in sync with the display plans in src/heleket.js.
const PLANS = {
  monthly: { amount: '9.99', label: 'Monthly' },
  quarterly: { amount: '25.99', label: '3 months' },
  yearly: { amount: '99.99', label: 'Yearly' },
};

// Heleket auth: sign = md5(base64(JSON.stringify(body)) + API_KEY), sent in the
// `sign` header alongside the `merchant` uuid header.
function heleketSign(jsonBody, apiKey) {
  const b64 = Buffer.from(jsonBody, 'utf8').toString('base64');
  return crypto.createHash('md5').update(b64 + (apiKey || ''), 'utf8').digest('hex');
}

async function heleketFetch(path, body) {
  const apiKey = process.env.HELEKET_API_KEY || '';
  const merchant = process.env.HELEKET_MERCHANT_ID || '';
  if (!apiKey || !merchant) {
    return { ok: false, error: 'Heleket is not configured yet — set HELEKET_API_KEY and HELEKET_MERCHANT_ID.' };
  }
  const json = JSON.stringify(body);
  let res;
  try {
    res = await fetch(`${HELEKET_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchant,
        sign: heleketSign(json, apiKey),
      },
      body: json,
    });
  } catch (err) {
    return { ok: false, error: 'Could not reach the Heleket API.' };
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (err) { data = null; }
  if (!res.ok || !data || data.state !== 0) {
    return { ok: false, error: (data && (data.message || data.error)) || `Heleket API error (${res.status})`, raw: data };
  }
  return { ok: true, data };
}

function cleanOrderId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function planOf(id) {
  return PLANS[String(id || '').toLowerCase()] || null;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else {
    try {
      for await (const chunk of req) raw += chunk;
    } catch (err) { /* body stream failed */ }
  }
  try { return JSON.parse(raw || '{}'); } catch (err) { return {}; }
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function createInvoice(req, res, body) {
  const plan = planOf(body.plan);
  if (!plan) return json(res, 400, { ok: false, error: 'Unknown plan — expected monthly, quarterly or yearly.' });
  const orderId = cleanOrderId(body.order_id);
  if (!orderId) return json(res, 400, { ok: false, error: 'A unique order_id is required.' });

  // Return/callback URLs point back at the app so the payment page can hand
  // the user back and status callbacks arrive here. Only added when we know
  // the origin (browser requests carry it; server-to-server calls skip it).
  const origin = String(req.headers.origin || req.headers.referer || '').replace(/\/$/, '');
  const payload = {
    amount: plan.amount,
    currency: 'USD',
    order_id: orderId,
    lifetime: 3600,
    additional_data: `glitchit-verified-${plan.id}`,
  };
  if (origin) {
    payload.url_return = `${origin}/?heleket=return`;
    payload.url_success = `${origin}/?heleket=paid`;
    payload.url_callback = `${origin}/api/heleket/webhook`;
  }

  const out = await heleketFetch('/payment', payload);
  if (!out.ok) return json(res, 502, out);
  const result = out.data.result || {};
  return json(res, 200, {
    ok: true,
    url: result.url || null,
    uuid: result.uuid || null,
    order_id: result.order_id || orderId,
    status: result.payment_status || result.status || 'check',
  });
}

async function paymentStatus(req, res, body) {
  const orderId = cleanOrderId(body.order_id);
  if (!orderId) return json(res, 400, { ok: false, error: 'order_id is required.' });
  const out = await heleketFetch('/payment/info', { order_id: orderId });
  if (!out.ok) return json(res, 502, out);
  const result = out.data.result || {};
  const status = result.status || result.payment_status || '';
  return json(res, 200, { ok: true, status, paid: status === 'paid' || status === 'paid_over', result });
}

async function webhook(req, res, body) {
  // Heleket posts status changes here. The client confirms payment via the
  // /status polling endpoint (the invoice url_callback above); this endpoint
  // exists so Heleket gets a clean 200 and stops retrying. Future server-side
  // order records can hook in here using body.order_id + body.status.
  return json(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname.replace(/^\/api\/heleket/, '') || '/';
  const body = await readJson(req);
  if (path === '/create') return createInvoice(req, res, body);
  if (path === '/status') return paymentStatus(req, res, body);
  if (path === '/webhook') return webhook(req, res, body);
  return json(res, 404, { ok: false, error: 'Not found' });
};

module.exports.PLANS = PLANS;
