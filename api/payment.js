// GlitchIt Payment Gateway — server-side payment processing
// Built from scratch. Handles:
//   - Payment initialization (card, mobile money, bank, USSD)
//   - Payment verification by transaction reference
//   - Webhook receiver for payment confirmations
//   - Payment splits for marketplace (85% creator / 15% platform)
//   - Transaction logging and receipt generation
//
// This gateway is designed to work with any payment provider via a clean
// adapter interface. Configure your provider in the PROVIDER section below.
//
// Environment variables:
//   PAYMENT_PROVIDER    — 'flutterwave' | 'paystack' | 'stripe' | 'demo' (default: 'demo')
//   PAYMENT_SECRET_KEY  — Your payment provider's secret API key
//   PAYMENT_WEBHOOK_HASH — Webhook signature verification secret
'use strict';

// ─── Configuration ──────────────────────────────────────────────────
const PROVIDER = process.env.PAYMENT_PROVIDER || 'demo';
const SECRET_KEY = process.env.PAYMENT_SECRET_KEY || '';
const WEBHOOK_HASH = process.env.PAYMENT_WEBHOOK_HASH || '';

// Platform commission split
const PLATFORM_COMMISSION_PERCENT = 15;
const CREATOR_PAYOUT_PERCENT = 85;

// ─── Utilities ──────────────────────────────────────────────────────
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

function generateTxRef(prefix = 'glt') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`.toUpperCase();
}

// ─── In-memory transaction store (demo mode) ───────────────────────
// In production, replace with database writes.
const transactions = new Map();

function storeTransaction(txRef, data) {
  transactions.set(txRef, {
    ...data,
    tx_ref: txRef,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function getTransaction(txRef) {
  return transactions.get(txRef) || null;
}

function updateTransaction(txRef, updates) {
  const tx = transactions.get(txRef);
  if (tx) {
    Object.assign(tx, updates, { updated_at: new Date().toISOString() });
  }
}

// ─── Payment provider adapters ─────────────────────────────────────
// Each adapter implements: initialize(), verify(), handleWebhook()
// To add a new provider, create an adapter object with these methods.

const adapters = {
  // Demo adapter: simulates payment processing for development
  demo: {
    async initialize(payload) {
      const txRef = payload.tx_ref || generateTxRef();
      storeTransaction(txRef, {
        amount: payload.amount,
        currency: payload.currency || 'KES',
        email: payload.email || '',
        method: payload.method || 'card',
        title: payload.title || 'GlitchIt',
        status: 'initialized',
      });
      return {
        ok: true,
        tx_ref: txRef,
        status: 'initialized',
        message: 'Payment initialized (demo mode)',
      };
    },

    async verify(txRef) {
      const tx = getTransaction(txRef);
      if (!tx) return { ok: false, error: 'Transaction not found' };

      // In demo mode, auto-complete after initialization
      updateTransaction(txRef, { status: 'successful' });
      return {
        ok: true,
        status: 'successful',
        amount: tx.amount,
        currency: tx.currency,
        tx_ref: txRef,
        method: tx.method,
        created_at: tx.created_at,
      };
    },

    handleWebhook(body) {
      const event = body?.event || '';
      const txRef = body?.data?.tx_ref || '';
      if (event === 'charge.completed' && txRef) {
        updateTransaction(txRef, { status: 'successful' });
      }
      return { ok: true, processed: true };
    },
  },

  // Flutterwave adapter
  flutterwave: {
    BASE: 'https://api.flutterwave.com/v3',

    async initialize(payload) {
      if (!SECRET_KEY) {
        return { ok: false, error: 'Payment provider not configured. Set PAYMENT_SECRET_KEY.' };
      }

      const flwPayload = {
        tx_ref: payload.tx_ref || generateTxRef(),
        amount: payload.amount,
        currency: payload.currency || 'KES',
        redirect_url: payload.redirect_url || 'https://glitchit.app/receipt.html',
        customer: {
          email: payload.email || 'guest@glitchit.app',
          name: payload.customer_name || '',
          phone_number: payload.phone || '',
        },
        customizations: {
          title: payload.title || 'GlitchIt',
          description: payload.description || 'Payment to GlitchIt',
        },
      };

      if (payload.method === 'momo') {
        flwPayload.payment_type = 'mobilemoney';
      } else if (payload.method === 'bank') {
        flwPayload.payment_type = 'banktransfer';
      } else if (payload.method === 'ussd') {
        flwPayload.payment_type = 'ussd';
      }

      const res = await fetch(`${adapters.flutterwave.BASE}/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(flwPayload),
      });
      const data = await res.json();

      if (data.status === 'success') {
        storeTransaction(flwPayload.tx_ref, {
          amount: payload.amount,
          currency: payload.currency || 'KES',
          email: payload.email,
          method: payload.method,
          title: payload.title,
          flw_ref: data.data?.flw_ref || '',
          status: 'initialized',
        });
        return {
          ok: true,
          tx_ref: flwPayload.tx_ref,
          status: 'initialized',
          flw_ref: data.data?.flw_ref || '',
          payment_link: data.data?.link || '',
        };
      }
      return { ok: false, error: data.message || 'Failed to initialize payment' };
    },

    async verify(txRef) {
      if (!SECRET_KEY) return { ok: false, error: 'Payment provider not configured.' };

      const res = await fetch(
        `${adapters.flutterwave.BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
        { headers: { 'Authorization': `Bearer ${SECRET_KEY}` } }
      );
      const data = await res.json();

      if (data.status === 'success' && data.data) {
        updateTransaction(txRef, { status: data.data.status, flw_ref: data.data.flw_ref || '' });
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
    },

    handleWebhook(body) {
      const event = body?.event || '';
      const txRef = body?.data?.tx_ref || '';
      if (event === 'charge.completed' && body?.data?.status === 'successful' && txRef) {
        updateTransaction(txRef, { status: 'successful' });
      } else if (event === 'charge.failed' && txRef) {
        updateTransaction(txRef, { status: 'failed' });
      }
      return { ok: true, processed: true };
    },
  },

  // Paystack adapter (stub — implement when switching to Paystack)
  paystack: {
    async initialize(payload) {
      return { ok: false, error: 'Paystack adapter not yet implemented.' };
    },
    async verify(txRef) {
      return { ok: false, error: 'Paystack adapter not yet implemented.' };
    },
    handleWebhook() {
      return { ok: true, processed: false };
    },
  },

  // Stripe adapter (stub — implement when switching to Stripe)
  stripe: {
    async initialize(payload) {
      return { ok: false, error: 'Stripe adapter not yet implemented.' };
    },
    async verify(txRef) {
      return { ok: false, error: 'Stripe adapter not yet implemented.' };
    },
    handleWebhook() {
      return { ok: true, processed: false };
    },
  },
};

function getAdapter() {
  return adapters[PROVIDER] || adapters.demo;
}

// ─── Split calculation ──────────────────────────────────────────────
function calculateSplit(amount, currency = 'KES') {
  const platformAmount = Math.round(amount * PLATFORM_COMMISSION_PERCENT) / 100;
  const creatorAmount = Math.round(amount * CREATOR_PAYOUT_PERCENT) / 100;
  return {
    total: amount,
    platform: platformAmount,
    creator: creatorAmount,
    currency,
    platform_percent: PLATFORM_COMMISSION_PERCENT,
    creator_percent: CREATOR_PAYOUT_PERCENT,
  };
}

// ─── Route handlers ─────────────────────────────────────────────────

// POST /api/payment — Initialize a payment
async function handleInitialize(req, res) {
  const body = await readBody(req, 16 * 1024);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'A valid amount is required.' });
  }
  if (!body.method || !['card', 'momo', 'bank', 'ussd'].includes(body.method)) {
    return json(res, 400, { ok: false, error: 'A valid payment method is required (card, momo, bank, ussd).' });
  }

  const txRef = body.tx_ref || generateTxRef();
  const adapter = getAdapter();
  const result = await adapter.initialize({ ...body, tx_ref: txRef });
  return json(res, result.ok ? 200 : 400, result);
}

// POST /api/payment/verify — Verify a payment by tx_ref
async function handleVerify(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  const adapter = getAdapter();
  const result = await adapter.verify(body.tx_ref);
  return json(res, result.ok ? 200 : 400, result);
}

// GET /api/payment/verify?tx_ref=... — Verify via GET (for redirect flows)
async function handleVerifyGet(req, res, url) {
  const txRef = url.searchParams.get('tx_ref');
  if (!txRef) {
    return json(res, 400, { ok: false, error: 'tx_ref query parameter is required.' });
  }
  const adapter = getAdapter();
  const result = await adapter.verify(txRef);
  return json(res, result.ok ? 200 : 400, result);
}

// POST /api/payment/webhook — Payment provider webhook
async function handleWebhook(req, res) {
  const body = await readBody(req, 64 * 1024);
  if (!body) return json(res, 400, { ok: false, error: 'Invalid payload' });

  // In production, verify webhook signature using WEBHOOK_HASH
  // For Flutterwave: compare req.headers['verif-hash'] with WEBHOOK_HASH
  // For Paystack: verify with HMAC-SHA512 using PAYMENT_WEBHOOK_HASH
  // For Stripe: verify with stripe.webhooks.constructEvent()

  const adapter = getAdapter();
  const result = adapter.handleWebhook(body);
  return json(res, 200, result);
}

// POST /api/payment/split — Calculate payment split for marketplace
async function handleSplit(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'A valid amount is required.' });
  }
  const split = calculateSplit(body.amount, body.currency || 'KES');
  return json(res, 200, { ok: true, split });
}

// GET /api/payment/tx/:ref — Get transaction details
async function handleGetTransaction(req, res, txRef) {
  const tx = getTransaction(txRef);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });
  return json(res, 200, { ok: true, transaction: tx });
}

// ─── Express-style request router ──────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;

  // POST /api/payment — Initialize
  if (req.method === 'POST' && path === '/api/payment') {
    return handleInitialize(req, res);
  }

  // POST /api/payment/verify — Verify
  if (req.method === 'POST' && path === '/api/payment/verify') {
    return handleVerify(req, res);
  }

  // GET /api/payment/verify — Verify (redirect flow)
  if (req.method === 'GET' && path === '/api/payment/verify') {
    return handleVerifyGet(req, res, url);
  }

  // POST /api/payment/webhook — Webhook
  if (req.method === 'POST' && path === '/api/payment/webhook') {
    return handleWebhook(req, res);
  }

  // POST /api/payment/split — Split calculation
  if (req.method === 'POST' && path === '/api/payment/split') {
    return handleSplit(req, res);
  }

  // GET /api/payment/tx/:ref — Transaction details
  if (req.method === 'GET' && path.startsWith('/api/payment/tx/')) {
    const txRef = decodeURIComponent(path.slice('/api/payment/tx/'.length));
    return handleGetTransaction(req, res, txRef);
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
};

// Export for testing and external use
module.exports.calculateSplit = calculateSplit;
module.exports.generateTxRef = generateTxRef;
module.exports.getTransaction = getTransaction;
module.exports.adapters = adapters;
module.exports.PLATFORM_COMMISSION_PERCENT = PLATFORM_COMMISSION_PERCENT;
module.exports.CREATOR_PAYOUT_PERCENT = CREATOR_PAYOUT_PERCENT;
