// GlitchIt Payment Gateway — real STK push via Safaricom Daraja API
// Built from scratch. No third-party payment SDK.
//
// Flow:
//   1. User enters phone + amount → client calls POST /api/payment
//   2. Server gets OAuth token from Daraja → sends STK push to user's phone
//   3. User receives prompt on phone → enters M-Pesa PIN
//   4. Daraja calls our webhook → server confirms payment
//   5. Client polls GET /api/payment/verify → shows success
//
// Environment variables:
//   DARAJA_CONSUMER_KEY     — from Safaricom developer portal
//   DARAJA_CONSUMER_SECRET  — from Safaricom developer portal
//   DARAJA_SHORTCODE        — your business shortcode (sandbox: 174379)
//   DARAJA_PASSKEY          — from Safaricom developer portal
//   DARAJA_ENV              — 'sandbox' or 'production' (default: sandbox)
//   PAYMENT_MPESA_NUMBER    — displayed to users (default: 0143476934)
//   PAYMENT_BUSINESS_NAME   — displayed to users (default: GlitchIt)
'use strict';

// ─── Configuration ──────────────────────────────────────────────────
const DARAJA_KEY = process.env.DARAJA_CONSUMER_KEY || '';
const DARAJA_SECRET = process.env.DARAJA_CONSUMER_SECRET || '';
const DARAJA_SHORTCODE = process.env.DARAJA_SHORTCODE || '174379';
const DARAJA_PASSKEY = process.env.DARAJA_PASSKEY || '';
const DARAJA_ENV = process.env.DARAJA_ENV || 'sandbox';
const MPESA_NUMBER = process.env.PAYMENT_MPESA_NUMBER || '0143476934';
const BUSINESS_NAME = process.env.PAYMENT_BUSINESS_NAME || 'GlitchIt';

const DARAJA_BASE = DARAJA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const CALLBACK_URL = process.env.PAYMENT_CALLBACK_URL || '';

// ─── Platform commission split ──────────────────────────────────────
const PLATFORM_COMMISSION_PERCENT = 15;
const CREATOR_PAYOUT_PERCENT = 85;

// ─── OAuth token cache ──────────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = 0;

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

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ─── Transaction store ──────────────────────────────────────────────
// In production, replace with database (Supabase, etc.)
const transactions = new Map();

function storeTransaction(txRef, data) {
  transactions.set(txRef, {
    ...data,
    tx_ref: txRef,
    status: data.status || 'pending',
    merchant_request_id: '',
    checkout_request_id: '',
    result_code: '',
    result_desc: '',
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
  return tx;
}

function getAllPending() {
  const pending = [];
  for (const [ref, tx] of transactions) {
    if (tx.status !== 'verified' && tx.status !== 'rejected') {
      pending.push({ ...tx, tx_ref: ref });
    }
  }
  return pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

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

// ─── Daraja API helpers ─────────────────────────────────────────────

// Get OAuth token from Daraja
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!DARAJA_KEY || !DARAJA_SECRET) {
    throw new Error('Daraja credentials not configured. Set DARAJA_CONSUMER_KEY and DARAJA_CONSUMER_SECRET.');
  }

  const credentials = Buffer.from(`${DARAJA_KEY}:${DARAJA_SECRET}`).toString('base64');

  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${credentials}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Daraja OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_config?.access_token || data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in || 3599) * 1000) - 60000; // refresh 1 min early

  if (!cachedToken) {
    throw new Error('No access token in Daraja response');
  }

  return cachedToken;
}

// Generate Daraja password: Base64(Shortcode + Passkey + Timestamp)
function generatePassword(ts) {
  const str = `${DARAJA_SHORTCODE}${DARAJA_PASSKEY}${ts}`;
  return Buffer.from(str).toString('base64');
}

// Send STK push via Daraja
async function sendStkPush(phoneNumber, amount, txRef) {
  const token = await getAccessToken();
  const ts = timestamp();
  const password = generatePassword(ts);

  // Format phone: ensure 254 prefix, strip leading 0
  let formattedPhone = phoneNumber.replace(/[\s\-()]/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.slice(1);
  } else if (formattedPhone.startsWith('+254')) {
    formattedPhone = formattedPhone.slice(1);
  } else if (!formattedPhone.startsWith('254')) {
    formattedPhone = '254' + formattedPhone;
  }

  const payload = {
    BusinessShortCode: DARAJA_SHORTCODE,
    Password: password,
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: formattedPhone,
    PartyB: DARAJA_SHORTCODE,
    PhoneNumber: formattedPhone,
    CallBackURL: CALLBACK_URL || `https://glitchit.app/api/payment/webhook`,
    AccountReference: txRef,
    TransactionDesc: `GlitchIt payment ${txRef}`,
  };

  console.log(`[GlitchIt Pay] STK push → ${formattedPhone} for KES ${amount} (ref: ${txRef})`);

  const res = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (data.ResponseCode === '0' || data.ResponseCode === '00') {
    return {
      ok: true,
      merchant_request_id: data.MerchantRequestID,
      checkout_request_id: data.CheckoutRequestID,
      response_code: data.ResponseCode,
      response_description: data.ResponseDescription,
    };
  }

  return {
    ok: false,
    error: data.ResponseDescription || data.errorMessage || 'STK push failed',
    response_code: data.ResponseCode,
  };
}

// Query STK push result
async function queryStkResult(checkoutRequestId) {
  const token = await getAccessToken();
  const ts = timestamp();
  const password = generatePassword(ts);

  const res = await fetch(`${DARAJA_BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: DARAJA_SHORTCODE,
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  return await res.json();
}

// ─── Route handlers ─────────────────────────────────────────────────

// POST /api/payment — Initialize payment & send STK push
async function handleInitialize(req, res) {
  const body = await readBody(req, 16 * 1024);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'A valid amount is required.' });
  }

  const txRef = body.tx_ref || generateTxRef();
  const amount = Number(body.amount);
  const currency = body.currency || 'KES';
  const title = body.title || 'GlitchIt Payment';
  const email = body.email || '';
  const phone = body.phone || '';

  if (!phone || phone.length < 9) {
    return json(res, 400, { ok: false, error: 'A valid phone number is required.' });
  }

  // Store transaction
  storeTransaction(txRef, {
    amount,
    currency,
    email,
    phone,
    title,
    description: body.description || '',
  });

  // Check if Daraja credentials are configured
  if (!DARAJA_KEY || !DARAJA_SECRET) {
    // Demo mode: store as pending, no real STK push
    console.log(`[GlitchIt Pay] Demo mode — no Daraja credentials. Tx: ${txRef}`);
    return json(res, 200, {
      ok: true,
      tx_ref: txRef,
      status: 'pending',
      mode: 'demo',
      message: 'Daraja credentials not configured. Set DARAJA_CONSUMER_KEY and DARAJA_CONSUMER_SECRET for real STK push.',
      instructions: {
        mpesa_number: MPESA_NUMBER,
        amount: amount,
        currency: currency,
        reference: txRef,
        business_name: BUSINESS_NAME,
        steps: [
          `Open M-Pesa on your phone`,
          `Select "Lipa na M-Pesa" → "Pay Bill"`,
          `Enter Business Number: ${MPESA_NUMBER}`,
          `Enter Amount: ${currency} ${amount.toLocaleString()}`,
          `Enter Reference: ${txRef}`,
          `Confirm with your M-Pesa PIN`,
          `Enter the confirmation code below`,
        ],
      },
    });
  }

  // Real mode: send STK push
  try {
    const stkResult = await sendStkPush(phone, amount, txRef);

    if (stkResult.ok) {
      updateTransaction(txRef, {
        merchant_request_id: stkResult.merchant_request_id || '',
        checkout_request_id: stkResult.checkout_request_id || '',
        status: 'stk_sent',
      });

      return json(res, 200, {
        ok: true,
        tx_ref: txRef,
        status: 'stk_sent',
        mode: 'live',
        message: stkResult.response_description || 'An M-Pesa prompt has been sent to your phone. Enter your PIN to complete.',
        phone: phone,
      });
    } else {
      updateTransaction(txRef, { status: 'stk_failed' });
      return json(res, 400, {
        ok: false,
        error: stkResult.error || 'STK push failed. Please try again.',
        response_code: stkResult.response_code,
      });
    }
  } catch (err) {
    console.error(`[GlitchIt Pay] STK push error:`, err.message);
    updateTransaction(txRef, { status: 'error' });
    return json(res, 500, {
      ok: false,
      error: 'Payment service temporarily unavailable. Please try again.',
    });
  }
}

// POST /api/payment/webhook — Daraja callback (STK result)
async function handleWebhook(req, res) {
  const body = await readBody(req, 64 * 1024);

  if (!body) {
    json(res, 400, { ok: false, error: 'Invalid request' });
    return;
  }

  console.log(`[GlitchIt Pay] Webhook received:`, JSON.stringify(body).slice(0, 500));

  const callback = body.Body?.stkCallback;
  if (!callback) {
    json(res, 200, { ok: true });
    return;
  }

  const resultCode = callback.ResultCode;
  const resultDesc = callback.ResultDesc || '';
  const merchantRequestId = callback.MerchantRequestID || '';
  const checkoutRequestId = callback.CheckoutRequestID || '';

  // Find the transaction by checkout_request_id
  let foundRef = null;
  for (const [ref, tx] of transactions) {
    if (tx.checkout_request_id === checkoutRequestId) {
      foundRef = ref;
      break;
    }
  }

  if (!foundRef) {
    console.log(`[GlitchIt Pay] Webhook: no matching transaction for ${checkoutRequestId}`);
    json(res, 200, { ok: true });
    return;
  }

  if (resultCode === 0) {
    // Payment successful
    updateTransaction(foundRef, {
      status: 'verified',
      result_code: String(resultCode),
      result_desc: resultDesc,
      merchant_request_id: merchantRequestId,
    });
    console.log(`[GlitchIt Pay] ✅ Payment verified: ${foundRef}`);
  } else {
    // Payment failed or cancelled
    const status = resultCode === 1032 ? 'cancelled' : 'failed';
    updateTransaction(foundRef, {
      status,
      result_code: String(resultCode),
      result_desc: resultDesc,
      merchant_request_id: merchantRequestId,
    });
    console.log(`[GlitchIt Pay] ❌ Payment ${status}: ${foundRef} (code: ${resultCode})`);
  }

  json(res, 200, { ok: true });
}

// POST /api/payment/verify — Client polls for payment status
async function handleVerify(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }

  const tx = getTransaction(body.tx_ref);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });

  if (tx.status === 'verified') {
    return json(res, 200, {
      ok: true,
      status: 'verified',
      amount: tx.amount,
      currency: tx.currency,
      tx_ref: body.tx_ref,
      title: tx.title,
      created_at: tx.created_at,
    });
  }

  if (tx.status === 'rejected' || tx.status === 'cancelled' || tx.status === 'failed') {
    const msg = tx.status === 'cancelled' ? 'Payment was cancelled'
      : tx.status === 'failed' ? (tx.result_desc || 'Payment failed')
      : (tx.result_desc || 'Payment could not be verified');
    return json(res, 200, {
      ok: false,
      status: tx.status,
      error: msg,
    });
  }

  // Still pending — if we have a checkout_request_id, query Daraja directly
  if (tx.checkout_request_id && DARAJA_KEY && DARAJA_SECRET) {
    try {
      const queryResult = await queryStkResult(tx.checkout_request_id);
      const resultCode = queryResult.ResponseCode;

      if (resultCode === '0') {
        // Success
        updateTransaction(body.tx_ref, {
          status: 'verified',
          result_code: '0',
          result_desc: queryResult.ResponseDescription || '',
        });
        return json(res, 200, {
          ok: true,
          status: 'verified',
          amount: tx.amount,
          currency: tx.currency,
          tx_ref: body.tx_ref,
          title: tx.title,
        });
      }

      if (resultCode === '1032') {
        updateTransaction(body.tx_ref, {
          status: 'cancelled',
          result_code: '1032',
          result_desc: 'Transaction cancelled by user',
        });
        return json(res, 200, {
          ok: false,
          status: 'cancelled',
          error: 'Payment was cancelled',
        });
      }

      if (resultCode === '1') {
        updateTransaction(body.tx_ref, {
          status: 'failed',
          result_code: '1',
          result_desc: queryResult.ResponseDescription || 'Insufficient balance',
        });
        return json(res, 200, {
          ok: false,
          status: 'failed',
          error: queryResult.ResponseDescription || 'Payment failed',
        });
      }
    } catch (err) {
      // Query failed — keep polling
      console.log(`[GlitchIt Pay] Query error: ${err.message}`);
    }
  }

  // Still pending
  return json(res, 202, {
    ok: false,
    status: tx.status || 'pending',
    pending: true,
    message: tx.status === 'stk_sent'
      ? 'M-Pesa prompt sent — waiting for payment'
      : 'Processing payment...',
  });
}

// GET /api/payment/verify?tx_ref=... — Verify via GET
async function handleVerifyGet(req, res, url) {
  const txRef = url.searchParams.get('tx_ref');
  if (!txRef) return json(res, 400, { ok: false, error: 'tx_ref query parameter required.' });

  const tx = getTransaction(txRef);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });

  if (tx.status === 'verified') {
    return json(res, 200, {
      ok: true,
      status: 'verified',
      amount: tx.amount,
      currency: tx.currency,
      tx_ref: txRef,
    });
  }
  return json(res, 202, { ok: false, status: tx.status, pending: true });
}

// POST /api/payment/submit — Submit M-Pesa confirmation code (fallback for demo mode)
async function handleSubmit(req, res) {
  const body = await readBody(req, 8 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  if (!body.mpesa_code || !/^[A-Z0-9]{8,14}$/i.test(body.mpesa_code.trim())) {
    return json(res, 400, { ok: false, error: 'Enter a valid M-Pesa confirmation code (8-14 characters).' });
  }

  const tx = getTransaction(body.tx_ref);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found.' });
  if (tx.status === 'verified') {
    return json(res, 400, { ok: false, error: 'This payment has already been verified.' });
  }

  updateTransaction(body.tx_ref, {
    mpesa_code: body.mpesa_code.trim().toUpperCase(),
    status: 'submitted',
  });

  return json(res, 200, {
    ok: true,
    tx_ref: body.tx_ref,
    status: 'submitted',
    message: 'Confirmation code received. Payment is being verified.',
  });
}

// POST /api/payment/approve — Owner approves (admin)
async function handleApprove(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  const tx = getTransaction(body.tx_ref);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });

  updateTransaction(body.tx_ref, {
    status: 'verified',
    verified_by: body.admin || 'owner',
  });

  return json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'verified', message: 'Payment approved' });
}

// POST /api/payment/reject — Owner rejects (admin)
async function handleReject(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  const tx = getTransaction(body.tx_ref);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });

  updateTransaction(body.tx_ref, {
    status: 'rejected',
    rejection_reason: body.reason || 'Payment could not be verified',
  });

  return json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'rejected' });
}

// GET /api/payment/pending — List pending (admin)
async function handlePending(req, res) {
  const pending = getAllPending();
  return json(res, 200, { ok: true, count: pending.length, transactions: pending });
}

// POST /api/payment/split — Calculate split
async function handleSplit(req, res) {
  const body = await readBody(req, 4 * 1024);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'Valid amount required.' });
  }
  return json(res, 200, { ok: true, split: calculateSplit(body.amount, body.currency || 'KES') });
}

// GET /api/payment/config — Public config
async function handleConfig(req, res) {
  return json(res, 200, {
    ok: true,
    mpesa_number: MPESA_NUMBER,
    business_name: BUSINESS_NAME,
    mode: DARAJA_KEY ? 'live' : 'demo',
  });
}

// ─── Request router ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/payment') {
    return handleInitialize(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/webhook') {
    return handleWebhook(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/submit') {
    return handleSubmit(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/verify') {
    return handleVerify(req, res);
  }
  if (req.method === 'GET' && path === '/api/payment/verify') {
    return handleVerifyGet(req, res, url);
  }
  if (req.method === 'POST' && path === '/api/payment/approve') {
    return handleApprove(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/reject') {
    return handleReject(req, res);
  }
  if (req.method === 'GET' && path === '/api/payment/pending') {
    return handlePending(req, res);
  }
  if (req.method === 'POST' && path === '/api/payment/split') {
    return handleSplit(req, res);
  }
  if (req.method === 'GET' && path === '/api/payment/config') {
    return handleConfig(req, res);
  }

  return json(res, 405, { ok: false, error: 'Method not allowed.' });
};

module.exports.calculateSplit = calculateSplit;
module.exports.generateTxRef = generateTxRef;
module.exports.getTransaction = getTransaction;
module.exports.getAllPending = getAllPending;
module.exports.PLATFORM_COMMISSION_PERCENT = PLATFORM_COMMISSION_PERCENT;
module.exports.CREATOR_PAYOUT_PERCENT = CREATOR_PAYOUT_PERCENT;
