// GlitchIt — POST /api/stripe-webhook: Stripe delivers subscription lifecycle
// events here. The signature is verified with the webhook secret (server-side
// only), so a forged request can never flip someone's premium status. On a
// successful checkout the subscription is recorded in Supabase (best-effort,
// only when the service-role key + a premium_subscriptions table exist), which
// lets the app gate premium features later. Works as a Vercel serverless
// function AND from server.js (same pattern as api/accounts.js).
//
// Required env vars:
//   STRIPE_WEBHOOK_SECRET     - Stripe → Developers → Webhooks → signing secret
//   SUPABASE_URL              - already set in the project
//   SUPABASE_SERVICE_ROLE_KEY - only needed to persist the subscription row
//
// When the webhook secret is missing the endpoint returns 400 so Stripe does
// not retry forever, and the premium page still works — it just can't flip
// server-side status yet.
'use strict';

const crypto = require('node:crypto');

const BODY_MAX = 1024 * 1024;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Constant-time signature check (Stripe signs "<timestamp>.<raw-body>").
function signatureOk(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const pair of sigHeader.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    parts[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Best-effort record: upsert one row per user in premium_subscriptions
// (user_id must be unique). If the table doesn't exist yet, the app keeps
// working — the write just logs a warning.
async function recordPremium(session) {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const userId = String((session.client_reference_id) || '');
  if (!serviceRole || !supabaseUrl || !userId) return; // nothing to attribute
  const plan = (session.metadata && session.metadata.plan) === 'yearly' ? 'yearly' : 'monthly';
  const row = {
    user_id: userId,
    stripe_customer_id: String(session.customer || ''),
    stripe_subscription_id: String(session.subscription || ''),
    plan,
    status: 'active',
    updated_at: new Date().toISOString(),
  };
  try {
    await fetch(`${supabaseUrl}/rest/v1/premium_subscriptions?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });
  } catch (err) {
    console.warn('GlitchIt: could not record premium subscription', err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const sigHeader = String((req.headers && req.headers['stripe-signature']) || '');
  if (!secret) {
    json(res, 400, { ok: false, error: 'Webhook secret not configured.' });
    return;
  }

  const raw = await readRawBody(req, BODY_MAX);
  if (!raw || !signatureOk(raw, sigHeader, secret)) {
    json(res, 400, { ok: false, error: 'Invalid signature.' });
    return;
  }

  let event = null;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    json(res, 400, { ok: false, error: 'Invalid payload.' });
    return;
  }

  const type = event && event.type;
  const session = event && event.data && event.data.object;
  if (type === 'checkout.session.completed' && session && session.payment_status === 'paid') {
    await recordPremium(session);
  }

  // Always acknowledge valid events — Stripe retries anything that is not 2xx.
  json(res, 200, { received: true, type });
};
