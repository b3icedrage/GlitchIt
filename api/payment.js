// GlitchIt Native Payment System — built from scratch, no third-party dependency
// Users pay via M-Pesa (Lipa na M-Pesa) and enter confirmation codes.
// The system stores transactions for verification and approval.
//
// How it works:
//   1. User selects what to pay for
//   2. System shows the owner's M-Pesa number, amount, and reference
//   3. User pays via M-Pesa on their phone
//   4. User enters the M-Pesa confirmation code (e.g. SHJ3K4ABCD)
//   5. System stores the transaction as "pending verification"
//   6. Owner verifies via the admin endpoint
//
// Environment variables (optional, for display purposes):
//   PAYMENT_MPESA_NUMBER  — Your M-Pesa number (e.g. '0712345678')
//   PAYMENT_BUSINESS_NAME — Your business name (e.g. 'GlitchIt')
'use strict';

const MPESA_NUMBER = process.env.PAYMENT_MPESA_NUMBER || '0143476934';
const BUSINESS_NAME = process.env.PAYMENT_BUSINESS_NAME || 'GlitchIt';

// ─── Platform commission split ──────────────────────────────────────
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

// ─── Transaction store ──────────────────────────────────────────────
// In production, replace with database writes (Supabase, etc.)
const transactions = new Map();

function storeTransaction(txRef, data) {
  transactions.set(txRef, {
    ...data,
    tx_ref: txRef,
    status: data.status || 'pending', // pending → submitted → verified → rejected
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
    if (tx.status === 'submitted') pending.push({ ...tx, tx_ref: ref });
  }
  return pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ─── Validate M-Pesa confirmation code format ───────────────────────
// M-Pesa codes are typically 10-12 alphanumeric characters
function isValidMpesaCode(code) {
  return /^[A-Z0-9]{8,14}$/i.test(code.trim());
}

// ─── Payment split calculation ──────────────────────────────────────
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

// POST /api/payment — Initialize a payment (get payment instructions)
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
  const method = body.method || 'mpesa';

  storeTransaction(txRef, {
    amount,
    currency,
    email,
    method,
    title,
    description: body.description || '',
    mpesa_code: '',
    verified_by: '',
    rejection_reason: '',
  });

  // Return payment instructions
  return json(res, 200, {
    ok: true,
    tx_ref: txRef,
    status: 'pending',
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

// POST /api/payment/submit — Submit M-Pesa confirmation code
async function handleSubmit(req, res) {
  const body = await readBody(req, 8 * 1024);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  if (!body.mpesa_code || !isValidMpesaCode(body.mpesa_code)) {
    return json(res, 400, { ok: false, error: 'Enter a valid M-Pesa confirmation code (8-14 characters).' });
  }

  const tx = getTransaction(body.tx_ref);
  if (!tx) {
    return json(res, 404, { ok: false, error: 'Transaction not found.' });
  }
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

// POST /api/payment/verify — Verify a payment by tx_ref (user polling)
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

  if (tx.status === 'rejected') {
    return json(res, 200, {
      ok: false,
      status: 'rejected',
      error: tx.rejection_reason || 'Payment could not be verified',
    });
  }

  // Still pending or submitted
  return json(res, 202, {
    ok: false,
    status: tx.status,
    pending: true,
    message: tx.status === 'submitted'
      ? 'Confirmation code received — waiting for verification'
      : 'Waiting for you to submit confirmation code',
  });
}

// GET /api/payment/verify?tx_ref=... — Verify via GET
async function handleVerifyGet(req, res, url) {
  const txRef = url.searchParams.get('tx_ref');
  if (!txRef) return json(res, 400, { ok: false, error: 'tx_ref query parameter required.' });

  const tx = getTransaction(txRef);
  if (!tx) return json(res, 404, { ok: false, error: 'Transaction not found' });

  if (tx.status === 'verified') {
    return json(res, 200, { ok: true, status: 'verified', amount: tx.amount, currency: tx.currency, tx_ref: txRef });
  }
  return json(res, 202, { ok: false, status: tx.status, pending: true });
}

// POST /api/payment/approve — Owner approves a payment (admin)
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

  return json(res, 200, {
    ok: true,
    tx_ref: body.tx_ref,
    status: 'verified',
    message: 'Payment approved',
  });
}

// POST /api/payment/reject — Owner rejects a payment (admin)
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

  return json(res, 200, {
    ok: true,
    tx_ref: body.tx_ref,
    status: 'rejected',
  });
}

// GET /api/payment/pending — List all pending verifications (admin)
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

// GET /api/payment/config — Get public payment config (M-Pesa number, etc.)
async function handleConfig(req, res) {
  return json(res, 200, {
    ok: true,
    mpesa_number: MPESA_NUMBER,
    business_name: BUSINESS_NAME,
  });
}

// ─── Request router ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/payment') {
    return handleInitialize(req, res);
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
