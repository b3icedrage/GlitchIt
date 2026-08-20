// GlitchIt Payment — own unique confirmation-code system
// No Safaricom Daraja. No third-party SDK.
//
// Flow:
//   1. User enters phone number + amount
//   2. System shows your M-Pesa number, amount, and reference
//   3. User pays via M-Pesa (Lipa na M-Pesa → Pay Bill)
//   4. User enters the M-Pesa confirmation code (SMS receipt)
//   5. Payment is stored as pending — you verify it
//
'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');

// ─── Configuration ──────────────────────────────────────────────────
const MPESA_NUMBER = process.env.PAYMENT_MPESA_NUMBER || '0143476934';
const BUSINESS_NAME = process.env.PAYMENT_BUSINESS_NAME || 'GlitchIt';
const DATABASE_URL = process.env.DATABASE_URL;

// ─── Database ───────────────────────────────────────────────────────
let pool = null;
function getDb() {
  if (!pool && DATABASE_URL) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => console.error('[Payment/DB] Error:', err.message));
  }
  return pool;
}

// ─── Helpers ────────────────────────────────────────────────────────
function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { resolve(null); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function generateTxRef() {
  return `GLT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function formatPhone(phone) {
  let d = phone.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return '254' + d.slice(1);
  if (d.length === 12 && d.startsWith('254')) return d;
  return d;
}

function isValidPhone(phone) {
  const d = phone.replace(/\D/g, '');
  return d.length >= 9;
}

// ─── Route Handlers ─────────────────────────────────────────────────

// POST /api/payment — Initialize payment (returns your M-Pesa number + instructions)
async function handleInitialize(req, res) {
  const body = await readBody(req);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'A valid amount is required.' });
  }

  const txRef = body.tx_ref || generateTxRef();
  const amount = Math.round(Number(body.amount));
  const title = body.title || 'GlitchIt Payment';
  const phone = body.phone || '';

  // Try to store in database (optional — works without DB too)
  const db = getDb();
  if (db) {
    try {
      await db.query(
        `INSERT INTO transactions (id, merchant_id, checkout_request_id, amount, phone_number, account_reference, status, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, $2, $3, $4, 'PENDING', NOW(), NOW())
         ON CONFLICT (checkout_request_id) DO NOTHING`,
        [txRef, amount, phone || MPESA_NUMBER, title]
      );
    } catch (e) {
      // DB not available — still work without it
      console.log('[Payment] DB not available, storing in memory');
    }
  }

  console.log(`[Payment] 💰 Charge created: KES ${amount} (ref: ${txRef})`);

  // Return payment instructions — the customer uses these to pay
  json(res, 200, {
    ok: true,
    tx_ref: txRef,
    status: 'pending',
    instructions: {
      mpesa_number: MPESA_NUMBER,
      amount: amount,
      currency: 'KES',
      reference: txRef,
      business_name: BUSINESS_NAME,
      steps: [
        `Open M-Pesa on your phone`,
        `Select "Lipa na M-Pesa" → "Pay Bill"`,
        `Enter Business Number: ${MPESA_NUMBER}`,
        `Enter Amount: KES ${amount.toLocaleString()}`,
        `Enter Reference: ${txRef}`,
        `Confirm with your M-Pesa PIN`,
        `Enter the confirmation code below`,
      ],
    },
  });
}

// POST /api/payment/submit — Submit M-Pesa confirmation code
async function handleSubmit(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }
  if (!body.mpesa_code || !/^[A-Z0-9]{8,14}$/i.test(body.mpesa_code.trim())) {
    return json(res, 400, { ok: false, error: 'Enter a valid M-Pesa confirmation code (8-14 characters).' });
  }

  const db = getDb();
  if (db) {
    try {
      await db.query(
        `UPDATE transactions SET stk_response_description = $1, status = 'SUBMITTED', updated_at = NOW()
         WHERE checkout_request_id = $2`,
        [body.mpesa_code.trim().toUpperCase(), body.tx_ref]
      );
    } catch (e) { /* ignore */ }
  }

  console.log(`[Payment] 📱 Code submitted: ${body.tx_ref} → ${body.mpesa_code}`);

  json(res, 200, {
    ok: true,
    tx_ref: body.tx_ref,
    status: 'submitted',
    message: 'Confirmation code received. Payment pending verification.',
  });
}

// POST /api/payment/verify — Check payment status (client polls this)
async function handleVerify(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) {
    return json(res, 400, { ok: false, error: 'tx_ref is required.' });
  }

  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        'SELECT status, amount, mpesa_receipt_number FROM transactions WHERE checkout_request_id = $1',
        [body.tx_ref]
      );

      if (result.rows.length > 0) {
        const tx = result.rows[0];
        if (tx.status === 'VERIFIED') {
          return json(res, 200, {
            ok: true, status: 'verified', amount: Number(tx.amount), tx_ref: body.tx_ref,
          });
        }
        if (tx.status === 'REJECTED') {
          return json(res, 200, { ok: false, status: 'rejected', error: 'Payment could not be verified' });
        }
        return json(res, 202, {
          ok: false, status: tx.status.toLowerCase(), pending: true,
          message: tx.status === 'SUBMITTED' ? 'Code received — waiting for verification' : 'Waiting for confirmation code',
        });
      }
    } catch (e) { /* ignore */ }
  }

  // Fallback: return pending
  json(res, 202, { ok: false, status: 'pending', pending: true, message: 'Processing...' });
}

// GET /api/payment/verify?tx_ref=... — Verify via GET
async function handleVerifyGet(req, res, url) {
  const txRef = url.searchParams.get('tx_ref');
  if (!txRef) return json(res, 400, { ok: false, error: 'tx_ref required' });

  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        'SELECT status, amount FROM transactions WHERE checkout_request_id = $1', [txRef]
      );
      if (result.rows.length > 0) {
        const tx = result.rows[0];
        if (tx.status === 'VERIFIED') {
          return json(res, 200, { ok: true, status: 'verified', amount: Number(tx.amount), tx_ref: txRef });
        }
      }
    } catch (e) { /* ignore */ }
  }
  json(res, 202, { ok: false, status: 'pending', pending: true });
}

// GET /api/payment/config — Get public config
function handleConfig(req, res) {
  json(res, 200, {
    ok: true,
    mpesa_number: MPESA_NUMBER,
    business_name: BUSINESS_NAME,
    mode: 'live',
  });
}

// POST /api/payment/approve — Owner approves (admin)
async function handleApprove(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });

  const db = getDb();
  if (db) {
    try {
      await db.query(
        `UPDATE transactions SET status = 'VERIFIED', updated_at = NOW() WHERE checkout_request_id = $1`,
        [body.tx_ref]
      );
    } catch (e) { /* ignore */ }
  }

  console.log(`[Payment] ✅ Approved: ${body.tx_ref}`);
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'verified', message: 'Payment approved' });
}

// POST /api/payment/reject — Owner rejects
async function handleReject(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });

  const db = getDb();
  if (db) {
    try {
      await db.query(
        `UPDATE transactions SET status = 'REJECTED', updated_at = NOW() WHERE checkout_request_id = $1`,
        [body.tx_ref]
      );
    } catch (e) { /* ignore */ }
  }

  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'rejected' });
}

// GET /api/payment/pending — List pending (admin)
async function handlePending(req, res) {
  const db = getDb();
  if (!db) return json(res, 200, { ok: true, count: 0, transactions: [] });

  try {
    const result = await db.query(
      `SELECT checkout_request_id, amount, phone_number, account_reference, status,
              stk_response_description as mpesa_code, created_at
       FROM transactions WHERE status IN ('PENDING','SUBMITTED')
       ORDER BY created_at DESC LIMIT 50`
    );
    json(res, 200, { ok: true, count: result.rows.length, transactions: result.rows });
  } catch (e) {
    json(res, 200, { ok: true, count: 0, transactions: [] });
  }
}

// ─── Router ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;
  const method = req.method;

  // CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (method === 'POST' && path === '/api/payment') return handleInitialize(req, res);
  if (method === 'POST' && path === '/api/payment/submit') return handleSubmit(req, res);
  if (method === 'POST' && path === '/api/payment/verify') return handleVerify(req, res);
  if (method === 'GET' && path === '/api/payment/verify') return handleVerifyGet(req, res, url);
  if (method === 'GET' && path === '/api/payment/config') return handleConfig(req, res);
  if (method === 'POST' && path === '/api/payment/approve') return handleApprove(req, res);
  if (method === 'POST' && path === '/api/payment/reject') return handleReject(req, res);
  if (method === 'GET' && path === '/api/payment/pending') return handlePending(req, res);

  json(res, 405, { ok: false, error: 'Method not allowed' });
};

module.exports.MPESA_NUMBER = MPESA_NUMBER;
module.exports.BUSINESS_NAME = BUSINESS_NAME;
