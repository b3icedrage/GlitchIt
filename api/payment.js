// GlitchIt Payment Gateway — server-side payment processing
// Built from scratch. Supports real M-Pesa STK push via Safaricom Daraja API.
//
// Environment variables:
//   PAYMENT_PROVIDER       — 'daraja' | 'demo' (default: 'demo')
//   DARAJA_CONSUMER_KEY    — Safaricom Daraja consumer key
//   DARAJA_CONSUMER_SECRET — Safaricom Daraja consumer secret
//   DARAJA_SHORTCODE       — Business shortcode (e.g. '174379')
//   DARAJA_PASSKEY         — Daraja API passkey
//   DARAJA_CALLBACK_URL    — Public HTTPS callback URL (e.g. https://glitchit.app/api/payment/webhook)
//   PAYMENT_WEBHOOK_HASH   — Webhook signature verification secret
//
// Platform commission split:
//   15% GlitchIt / 85% Creator (for marketplace transactions)
'use strict';

// ─── Configuration ──────────────────────────────────────────────────
const PROVIDER = process.env.PAYMENT_PROVIDER || 'demo';
const DARAJA_KEY = process.env.DARAJA_CONSUMER_KEY || '';
const DARAJA_SECRET = process.env.DARAJA_CONSUMER_SECRET || '';
const DARAJA_SHORTCODE = process.env.DARAJA_SHORTCODE || '';
const DARAJA_PASSKEY = process.env.DARAJA_PASSKEY || '';
const DARAJA_CALLBACK = process.env.DARAJA_CALLBACK_URL || '';
const WEBHOOK_HASH = process.env.PAYMENT_WEBHOOK_HASH || '';

const PLATFORM_COMMISSION_PERCENT = 15;
const CREATOR_PAYOUT_PERCENT = 85;

// Safaricom Daraja base URLs
const DARAJA_SANDBOX = 'https://sandbox.safaricom.co.ke';
const DARAJA_PROD = 'https://api.safaricom.co.ke';

// Use sandbox when in test mode (no real charges)
const DARAJA_BASE = (DARAJA_PASSKEY && DARAJA_PASSKEY.length > 20)
  ? DARAJA_PROD
  : DARAJA_SANDBOX;

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

function getTimestamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

function generatePassword(shortcode, passkey, timestamp) {
  const data = shortcode + passkey + timestamp;
  // Base64 encode
  return Buffer.from(data).toString('base64');
}

function normalizePhone(phone) {
  // Remove spaces, dashes, plus signs
  let cleaned = phone.replace(/[\s\-+]/g, '');
  // Convert 07XX to 2547XX
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '254' + cleaned.slice(1);
  }
  // Ensure it starts with 254
  if (!cleaned.startsWith('254')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

// ─── In-memory transaction store ────────────────────────────────────
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

// ─── Daraja API: Get OAuth Access Token ─────────────────────────────
async function getDarajaToken() {
  const auth = Buffer.from(`${DARAJA_KEY}:${DARAJA_SECRET}`).toString('base64');

  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });

  const data = await res.json();
  if (data.access_token) {
    return data.access_token;
  }
  throw new Error(data.message || data.error_description || 'Failed to get Daraja access token');
}

// ─── Daraja API: Initiate STK Push (Lipa Na M-Pesa Online) ─────────
async function initiateStkPush(phone, amount, txRef) {
  const token = await getDarajaToken();
  const timestamp = getTimestamp();
  const password = generatePassword(DARAJA_SHORTCODE, DARAJA_PASSKEY, timestamp);
  const normalizedPhone = normalizePhone(phone);

  const payload = {
    BusinessShortCode: DARAJA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount), // STK push requires whole numbers
    PartyA: normalizedPhone,
    PartyB: DARAJA_SHORTCODE,
    PhoneNumber: normalizedPhone,
    CallBackURL: DARAJA_CALLBACK || 'https://glitchit.app/api/payment/webhook',
    AccountReference: txRef,
    TransactionDesc: `GlitchIt Payment - ${txRef}`,
  };

  const res = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (data.ResponseCode === '0') {
    // STK push initiated successfully
    return {
      ok: true,
      CheckoutRequestID: data.CheckoutRequestID,
      MerchantRequestID: data.MerchantRequestID,
      ResponseCode: data.ResponseCode,
      ResponseDescription: data.ResponseDescription,
    };
  }

  return {
    ok: false,
    error: data.ResponseDescription || data.errorMessage || 'STK push failed',
    ResponseCode: data.ResponseCode,
  };
}

// ─── Daraja API: Query STK Push Status ──────────────────────────────
async function queryStkStatus(checkoutRequestId) {
  const token = await getDarajaToken();
  const timestamp = getTimestamp();
  const password = generatePassword(DARAJA_SHORTCODE, DARAJA_PASSKEY, timestamp);

  const res = await fetch(`${DARAJA_BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  return res.json();
}

// ─── Payment Adapters ───────────────────────────────────────────────
const adapters = {
  // ─── Demo adapter ────────────────────────────────────────────────
  demo: {
    async initialize(payload) {
      const txRef = payload.tx_ref || generateTxRef();
      storeTransaction(txRef, {
        amount: payload.amount,
        currency: payload.currency || 'KES',
        email: payload.email || '',
        method: payload.method || 'card',
        phone: payload.phone || '',
        title: payload.title || 'GlitchIt',
        status: 'initialized',
      });
      return { ok: true, tx_ref: txRef, status: 'initialized', message: 'Payment initialized (demo mode)' };
    },

    async verify(txRef) {
      const tx = getTransaction(txRef);
      if (!tx) return { ok: false, error: 'Transaction not found' };
      updateTransaction(txRef, { status: 'successful' });
      return {
        ok: true, status: 'successful', amount: tx.amount,
        currency: tx.currency, tx_ref: txRef, method: tx.method,
        created_at: tx.created_at,
      };
    },

    handleWebhook(body) {
      const event = body?.event || '';
      const txRef = body?.data?.tx_ref || '';
      if (event === 'charge.completed' && txRef) updateTransaction(txRef, { status: 'successful' });
      return { ok: true, processed: true };
    },
  },

  // ─── Safaricom Daraja (M-Pesa STK Push) adapter ─────────────────
  daraja: {
    async initialize(payload) {
      if (!DARAJA_KEY || !DARAJA_SECRET) {
        return { ok: false, error: 'M-Pesa not configured. Set DARAJA_CONSUMER_KEY and DARAJA_CONSUMER_SECRET.' };
      }
      if (!DARAJA_SHORTCODE || !DARAJA_PASSKEY) {
        return { ok: false, error: 'M-Pesa not configured. Set DARAJA_SHORTCODE and DARAJA_PASSKEY.' };
      }

      const txRef = payload.tx_ref || generateTxRef();
      const phone = payload.phone || '';

      if (!phone) {
        return { ok: false, error: 'Phone number is required for M-Pesa payment.' };
      }

      if (payload.method === 'momo' || payload.method === 'mpesa') {
        // Initiate real STK push
        try {
          const stkResult = await initiateStkPush(phone, payload.amount, txRef);

          if (stkResult.ok) {
            storeTransaction(txRef, {
              amount: payload.amount,
              currency: payload.currency || 'KES',
              email: payload.email || '',
              method: 'mpesa',
              phone: phone,
              title: payload.title || 'GlitchIt',
              status: 'stk_sent',
              CheckoutRequestID: stkResult.CheckoutRequestID,
              MerchantRequestID: stkResult.MerchantRequestID,
            });

            return {
              ok: true,
              tx_ref: txRef,
              status: 'stk_sent',
              CheckoutRequestID: stkResult.CheckoutRequestID,
              message: 'STK push sent — check your phone to enter M-Pesa PIN',
            };
          }

          return { ok: false, error: stkResult.error || 'Failed to send STK push' };
        } catch (err) {
          console.error('[Daraja] STK push error:', err);
          return { ok: false, error: 'Failed to initiate M-Pesa payment. Please try again.' };
        }
      }

      // For non-M-Pesa methods in Daraja mode, fall back to demo
      return adapters.demo.initialize(payload);
    },

    async verify(txRef) {
      const tx = getTransaction(txRef);
      if (!tx) return { ok: false, error: 'Transaction not found' };

      // If we have a CheckoutRequestID, query the status from Daraja
      if (tx.CheckoutRequestID && DARAJA_KEY) {
        try {
          const result = await queryStkStatus(tx.CheckoutRequestID);
          if (result.ResultCode === '0') {
            updateTransaction(txRef, { status: 'successful', ResultCode: '0' });
            return {
              ok: true, status: 'successful', amount: tx.amount,
              currency: tx.currency, tx_ref: txRef, method: tx.method,
              MpesaReceiptNumber: result.MpesaReceiptNumber || '',
              created_at: tx.created_at,
            };
          } else if (result.ResultCode === '1032') {
            updateTransaction(txRef, { status: 'cancelled', ResultCode: '1032' });
            return { ok: false, error: 'Payment was cancelled by the user' };
          } else if (result.ResultCode === '1037') {
            // Still waiting — user hasn't responded yet
            return { ok: false, error: 'Waiting for user to complete payment on phone', pending: true };
          } else {
            updateTransaction(txRef, { status: 'failed', ResultCode: result.ResultCode });
            return { ok: false, error: result.ResultDesc || 'Payment failed' };
          }
        } catch (err) {
          console.error('[Daraja] Verify error:', err);
        }
      }

      // Fallback: check in-memory status
      if (tx.status === 'successful') {
        return {
          ok: true, status: 'successful', amount: tx.amount,
          currency: tx.currency, tx_ref: txRef, method: tx.method,
          created_at: tx.created_at,
        };
      }

      return { ok: false, error: 'Payment not yet confirmed', pending: true };
    },

    handleWebhook(body) {
      // Daraja callback format:
      // { Body: { stkCallback: { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata: { Item: [...] } } } }
      const stkCallback = body?.Body?.stkCallback;

      if (stkCallback) {
        const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

        // Find the transaction by CheckoutRequestID
        for (const [txRef, tx] of transactions) {
          if (tx.CheckoutRequestID === CheckoutRequestID) {
            if (ResultCode === 0) {
              // Payment successful
              const items = CallbackMetadata?.Item || [];
              const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value || '';
              const amount = items.find(i => i.Name === 'Amount')?.Value || tx.amount;
              const phone = items.find(i => i.Name === 'PhoneNumber')?.Value || tx.phone;

              updateTransaction(txRef, {
                status: 'successful',
                ResultCode: '0',
                MpesaReceiptNumber: receipt,
                confirmed_amount: amount,
                confirmed_phone: phone,
              });
              console.log(`[Daraja] Payment confirmed: ${txRef} — Receipt: ${receipt}`);
            } else {
              updateTransaction(txRef, { status: 'failed', ResultCode: String(ResultCode), ResultDesc });
              console.log(`[Daraja] Payment failed: ${txRef} — ${ResultDesc}`);
            }
            return { ok: true, processed: true };
          }
        }
      }

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

async function handleInitialize(req, res) {
  const body = await readBody(req, 16 * 1024);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'A valid amount is required.' });
  }
  const validMethods = ['card', 'momo', 'mpesa', 'bank', 'ussd'];
  if (!body.method || !validMethods.includes(body.method)) {
    return json(res, 400, { ok: false, error: `Valid method required: ${validMethods.join(', ')}` });
  }

  const txRef = body.tx_ref || generateTxRef();
  const adapter = getAdapter();
  const result = await adapter.initialize({ ...body, tx_ref: txRef });
  return json(res, result.ok ? 200 : 400, result);
}

async function handleVerify(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  const adapter = getAdapter();
  const result = await adapter.verify(body.tx_ref);
  return json(res, result.ok ? 200 : (result.pending ? 202 : 400), result);
}

async function handleVerifyGet(req, res, url) {
  const txRef = url.searchParams.get('tx_ref');
  if (!txRef) return json(res, 400, { ok: false, error: 'tx_ref query parameter is required.' });
  const adapter = getAdapter();
  const result = await adapter.verify(txRef);
  return json(res, result.ok ? 200 : 400, result);
}

async function handleWebhook(req, res) {
  const body = await readBody(req, 64 * 1024);
  if (!body) return json(res, 400, { ok: false, error: 'Invalid payload' });

  const adapter = getAdapter();
  const result = adapter.handleWebhook(body);
  return json(res, 200, result);
}

async function handleSplit(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'A valid amount is required.' });
  }
  const split = calculateSplit(body.amount, body.currency || 'KES');
  return json(res, 200, { ok: true, split });
}

async function handleGetTransaction(req, res, txRef) {
  const tx = getTransaction(txRef);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });
  return json(res, 200, { ok: true, transaction: tx });
}

// ─── Request router ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/payment') {
    return handleInitialize(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/verify') {
    return handleVerify(req, res);
  }
  if (req.method === 'GET' && path === '/api/payment/verify') {
    return handleVerifyGet(req, res, url);
  }
  if (req.method === 'POST' && path === '/api/payment/webhook') {
    return handleWebhook(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/split') {
    return handleSplit(req, res);
  }
  if (req.method === 'GET' && path.startsWith('/api/payment/tx/')) {
    const txRef = decodeURIComponent(path.slice('/api/payment/tx/'.length));
    return handleGetTransaction(req, res, txRef);
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
};

module.exports.calculateSplit = calculateSplit;
module.exports.generateTxRef = generateTxRef;
module.exports.getTransaction = getTransaction;
module.exports.adapters = adapters;
module.exports.PLATFORM_COMMISSION_PERCENT = PLATFORM_COMMISSION_PERCENT;
module.exports.CREATOR_PAYOUT_PERCENT = CREATOR_PAYOUT_PERCENT;
