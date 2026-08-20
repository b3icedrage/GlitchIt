// GlitchIt Payment Gateway — server-side payment processing
// Uses Flutterwave's standard/inline API behind the scenes, but the user
// sees only GlitchIt's branded checkout UI. Supports:
//   - Card payments (Visa, Mastercard)
//   - Mobile Money (M-Pesa, MTN, Airtel)
//   - Bank Transfer
//   - USSD
//   - Payment splits (85% creator / 15% platform for marketplace drops)
//
// Required env vars:
//   FLUTTERWAVE_SECRET_KEY - from Flutterwave dashboard → Settings → API Keys
//
// Endpoints:
//   POST /api/payment        — Initialize a payment
//   POST /api/payment/verify — Verify a payment by tx_ref
//   POST /api/payment/webhook — Flutterwave webhook receiver
//   POST /api/payment/split  — Create a payment split for marketplace
'use strict';

const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';
const PLATFORM_PERCENT = 15; // GlitchIt takes 15% commission
const CREATOR_PERCENT = 85;  // Creator gets 85%

function getSecretKey() {
  return process.env.FLUTTERWAVE_SECRET_KEY || '';
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { resolve(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// ─── Initialize a payment via Flutterwave ───────────────────────────
async function initializePayment(body) {
  const key = getSecretKey();
  if (!key) {
    return { ok: false, error: 'Payment gateway is not configured. Add FLUTTERWAVE_SECRET_KEY to your environment.' };
  }

  const payload = {
    tx_ref: body.tx_ref || `glitchit-${Date.now()}`,
    amount: body.amount,
    currency: body.currency || 'KES',
    redirect_url: body.redirect_url || 'https://glitchit.app/receipt.html',
    customer: {
      email: body.email || 'guest@glitchit.app',
      name: body.customer_name || '',
      phone_number: body.phone || '',
    },
    customizations: {
      title: body.title || 'GlitchIt',
      description: body.description || 'Payment to GlitchIt',
      logo: 'https://glitchit.app/favicon.ico',
    },
    meta: {
      consumer_id: body.user_id || '',
      consumer_mac: '',
    },
  };

  // Add payment method config
  if (body.method === 'card') {
    // For inline card, Flutterwave handles the card details in the popup
    // Since we're doing custom UI, we use the standard endpoint
  } else if (body.method === 'momo') {
    payload.payment_type = 'mobilemoney';
    payload.customer.phone_number = body.phone || '';
  } else if (body.method === 'bank') {
    payload.payment_type = 'banktransfer';
  } else if (body.method === 'ussd') {
    payload.payment_type = 'ussd';
  }

  try {
    const res = await fetch(`${FLUTTERWAVE_BASE}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.status === 'success') {
      return {
        ok: true,
        tx_ref: payload.tx_ref,
        status: 'initialized',
        flw_ref: data.data?.flw_ref || '',
        payment_link: data.data?.link || '',
      };
    }
    return { ok: false, error: data.message || 'Failed to initialize payment' };
  } catch (err) {
    return { ok: false, error: 'Could not reach payment service' };
  }
}

// ─── Verify a payment ──────────────────────────────────────────────
async function verifyPayment(txRef) {
  const key = getSecretKey();
  if (!key) {
    return { ok: false, error: 'Payment gateway is not configured.' };
  }

  try {
    const res = await fetch(`${FLUTTERWAVE_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    const data = await res.json();
    if (data.status === 'success' && data.data) {
      return {
        ok: true,
        status: data.data.status,
        amount: data.data.amount,
        currency: data.data.currency,
        tx_ref: data.data.tx_ref,
        flw_ref: data.data.flw_ref,
        created_at: data.data.created_at,
      };
    }
    return { ok: false, error: data.message || 'Transaction not found' };
  } catch (err) {
    return { ok: false, error: 'Could not verify payment' };
  }
}

// ─── Create a payment split (for marketplace) ──────────────────────
async function createSplit(body) {
  const key = getSecretKey();
  if (!key) return { ok: false, error: 'Payment gateway not configured.' };

  const splitPayload = {
    type: 'percentage',
    name: `GlitchIt Drop Split - ${body.drop_id || 'unknown'}`,
    subaccounts: [
      {
        id: body.creator_subaccount_id,
        transaction_split_percentage: CREATOR_PERCENT,
      },
    ],
    currency: body.currency || 'KES',
    bearer_type: 'subaccount',
    bearer_subaccount: body.creator_subaccount_id,
  };

  try {
    const res = await fetch(`${FLUTTERWAVE_BASE}/splits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(splitPayload),
    });
    const data = await res.json();
    if (data.status === 'success') {
      return { ok: true, split_id: data.data?.id, split_type: data.data?.type };
    }
    return { ok: false, error: data.message || 'Failed to create split' };
  } catch (err) {
    return { ok: false, error: 'Could not create payment split' };
  }
}

// ─── Handle Flutterwave webhook ────────────────────────────────────
function handleWebhook(body) {
  // Flutterwave sends event payloads for: charge.completed, charge.failed, etc.
  // In production, verify the webhook signature using FLUTTERWAVE_HASH
  // (see https://developer.flutterwave.com/docs/integration-guides/webhooks)
  const event = body?.event || '';
  const data = body?.data || {};

  if (event === 'charge.completed' && data.status === 'successful') {
    // Payment successful — in production, credit the user's wallet, send receipt, etc.
    console.log(`[Payment Gateway] Payment successful: ${data.tx_ref} — KES ${data.amount}`);
    return { ok: true, processed: true };
  }

  if (event === 'charge.failed') {
    console.log(`[Payment Gateway] Payment failed: ${data.tx_ref}`);
    return { ok: true, processed: true };
  }

  return { ok: true, processed: false };
}

// ─── Express-style handler ─────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;

  // POST /api/payment — Initialize payment
  if (req.method === 'POST' && path === '/api/payment') {
    const body = await readBody(req, 16 * 1024);
    if (!body || !body.amount) {
      return json(res, 400, { ok: false, error: 'Amount is required.' });
    }
    const result = await initializePayment(body);
    return json(res, result.ok ? 200 : 400, result);
  }

  // POST /api/payment/verify — Verify payment
  if (req.method === 'POST' && path === '/api/payment/verify') {
    const body = await readBody(req, 4 * 1024);
    if (!body || !body.tx_ref) {
      return json(res, 400, { ok: false, error: 'tx_ref is required.' });
    }
    const result = await verifyPayment(body.tx_ref);
    return json(res, result.ok ? 200 : 400, result);
  }

  // GET /api/payment/verify?tx_ref=... — Verify via GET (for redirect flows)
  if (req.method === 'GET' && path === '/api/payment/verify') {
    const txRef = url.searchParams.get('tx_ref');
    if (!txRef) return json(res, 400, { ok: false, error: 'tx_ref query parameter is required.' });
    const result = await verifyPayment(txRef);
    return json(res, result.ok ? 200 : 400, result);
  }

  // POST /api/payment/webhook — Flutterwave webhook
  if (req.method === 'POST' && path === '/api/payment/webhook') {
    const body = await readBody(req, 64 * 1024);
    if (!body) return json(res, 400, { ok: false, error: 'Invalid payload' });
    const result = handleWebhook(body);
    return json(res, 200, result);
  }

  // POST /api/payment/split — Create split
  if (req.method === 'POST' && path === '/api/payment/split') {
    const body = await readBody(req, 8 * 1024);
    if (!body || !body.creator_subaccount_id) {
      return json(res, 400, { ok: false, error: 'creator_subaccount_id is required.' });
    }
    const result = await createSplit(body);
    return json(res, result.ok ? 200 : 400, result);
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
};

module.exports.PLATFORM_PERCENT = PLATFORM_PERCENT;
module.exports.CREATOR_PERCENT = CREATOR_PERCENT;
