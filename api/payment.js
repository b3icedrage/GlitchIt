// GlitchIt Pay — payment handler (PesaPal store links)
// Payments go through external PesaPal store pages.
// This backend handles premium activation tracking, IPN callbacks,
// and manual payment verification fallback.
//
// Required env vars (Vercel → Settings → Environment Variables):
//   PAYMENT_BUSINESS_NAME   — display name (default: 'GlitchIt')
//   DATABASE_URL            — PostgreSQL for transaction persistence (optional, graceful fallback)
'use strict';

const crypto = require('node:crypto');
let Pool;
try { Pool = require('pg').Pool; } catch (e) { /* pg optional */ }

// ─── Configuration (lazy — env vars may be injected after startup) ──
function cfg(k, fb) { return process.env[k] || fb; }
function getBusinessName() { return cfg('PAYMENT_BUSINESS_NAME', 'GlitchIt'); }
function getDatabaseUrl() { return cfg('DATABASE_URL', ''); }

// ─── Admin routes (approve / reject / pending) ─────────────────────
// These change transaction state or list every transaction, so they need the
// same X-Admin-Secret as /v1/admin/* (see api/settlement.js). SECURITY: no
// fallback secret — with ADMIN_SECRET unset they answer 503 instead of
// accepting a guessable default. Constant-time compare guards the timing
// channel.
function adminSecret() { return cfg('ADMIN_SECRET', ''); }

function requireAdminSecret(req) {
  const expected = adminSecret();
  if (!expected) {
    return { status: 503, body: { ok: false, error: 'Admin payment routes are not configured. Set ADMIN_SECRET in the environment.' } };
  }
  const provided = String(req.headers['x-admin-secret'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length === 0 || b.length !== a.length || !crypto.timingSafeEqual(a, b)) {
    return { status: 403, body: { ok: false, error: 'Unauthorized' } };
  }
  return null;
}

// ─── Database (optional, graceful) ──────────────────────────────────
let dbPool = null;
let tablesEnsured = false;

async function ensureTables(db) {
  if (tablesEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS premium_activations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        order_reference TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        activated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prem_act_email ON premium_activations (LOWER(email))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prem_act_status ON premium_activations (status)`);
    tablesEnsured = true;
    console.log('[Pay] ✅ premium_activations table ready');
  } catch (e) {
    console.log('[Pay] Table ensure skipped:', e.message);
    tablesEnsured = true;
  }
}

function getDb() {
  if (!Pool || !getDatabaseUrl()) return null;
  if (!dbPool) {
    try {
      dbPool = new Pool({
        connectionString: getDatabaseUrl(),
        ssl: { rejectUnauthorized: false },
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
      });
      dbPool.on('error', (err) => console.error('[Pay/DB]', err.message));
    } catch (e) { return null; }
  }
  return dbPool;
}

// ─── Helpers ────────────────────────────────────────────────────────
function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function generateTxRef() {
  return `GLT-${Date.now().toString(36).slice(-6).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ─── Route Handlers ─────────────────────────────────────────────────

// POST /api/payment/premium-init — Called when user clicks "Get Premium"
// Creates a PENDING premium activation so the IPN handler can match it.
async function handlePremiumInit(req, res) {
  const body = await readBody(req);
  const email = (body && body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return json(res, 400, { ok: false, error: 'Valid email required' });
  }

  const db = getDb();
  if (!db) {
    return json(res, 200, { ok: true, message: 'Proceed with payment', tracked: false });
  }

  await ensureTables(db);

  try {
    // Check if already active
    const existing = await db.query(
      `SELECT id, expires_at FROM premium_activations
       WHERE LOWER(email) = $1 AND status = 'verified' AND expires_at > NOW()
       ORDER BY expires_at DESC LIMIT 1`,
      [email]
    );
    if (existing.rows.length > 0) {
      return json(res, 200, {
        ok: true,
        message: 'Already premium',
        active: true,
        expiresAt: existing.rows[0].expires_at,
      });
    }

    // Create pending activation
    const ref = `premium-monthly-${Date.now()}-${email}`;
    await db.query(
      `INSERT INTO premium_activations (id, email, order_reference, status, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())`,
      [email, ref]
    );
    console.log(`[Pay] 📤 Premium init: ${email} ref=${ref}`);
    return json(res, 200, { ok: true, message: 'Proceed with payment', tracked: true });
  } catch (e) {
    console.log('[Pay] premium-init error:', e.message);
    return json(res, 200, { ok: true, message: 'Proceed with payment', tracked: false });
  }
}

// POST /api/payment/ipn — PesaPal IPN callback
async function handleIPN(req, res) {
  console.log(`[Pay] 📥 IPN received`);

  const body = await readBody(req);
  if (!body) return json(res, 200, { ok: true });

  const orderTrackingId = body.order_tracking_id || body.OrderTrackingId;
  const merchantRef = body.merchant_reference || body.MerchantReference;
  const status = (body.status || body.Status || '').toUpperCase();

  console.log(`[Pay] IPN: ${orderTrackingId} ref=${merchantRef} status=${status}`);

  if (!orderTrackingId && !merchantRef) return json(res, 200, { ok: true });

  let txStatus = 'PENDING';
  if (status === 'SUCCESS') txStatus = 'VERIFIED';
  else if (status === 'FAILED' || status === 'INVALID') txStatus = 'FAILED';
  else if (status === 'CANCELLED') txStatus = 'CANCELLED';

  const db = getDb();
  if (db) {
    await ensureTables(db);

    const lookupRef = orderTrackingId || merchantRef;
    try {
      const r = await db.query(
        `UPDATE transactions SET status = $1, stk_response_description = COALESCE(stk_response_description, $2),
         updated_at = NOW()
         WHERE checkout_request_id = $3 OR stk_response_description = $3
         RETURNING id`,
        [txStatus, orderTrackingId || '', lookupRef]
      );
      if (r.rows.length === 0) {
        await db.query(
          `INSERT INTO transactions (id, merchant_id, checkout_request_id, amount, phone_number,
           account_reference, status, stk_response_description, updated_at, created_at)
           VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, 0, '', '', $2, $3, NOW(), NOW())
           ON CONFLICT (checkout_request_id) DO UPDATE SET status = $2, updated_at = NOW()`,
          [merchantRef || orderTrackingId, txStatus, orderTrackingId || '']
        );
      }
    } catch (e) { console.log('[Pay] DB update skipped:', e.message); }

    // On successful payment, activate pending premium + extend existing
    if (txStatus === 'VERIFIED') {
      try {
        // Find all pending premium activations from the last hour
        const pendingResult = await db.query(
          `SELECT id, email FROM premium_activations
           WHERE status = 'pending' AND created_at > NOW() - INTERVAL '1 hour'`
        );
        for (const row of pendingResult.rows) {
          // Check if this email already has an active premium — extend from current expiry
          const existing = await db.query(
            `SELECT id, expires_at FROM premium_activations
             WHERE LOWER(email) = $1 AND status = 'verified' AND expires_at > NOW()
             ORDER BY expires_at DESC LIMIT 1`,
            [row.email]
          );
          let newExpiry;
          if (existing.rows.length > 0) {
            // EXTEND: add 30 days from current expiry
            const baseTime = Math.max(new Date(existing.rows[0].expires_at).getTime(), Date.now());
            newExpiry = new Date(baseTime + 30 * 24 * 60 * 60 * 1000);
            // Update the old record's expiry
            await db.query(`UPDATE premium_activations SET expires_at = $1 WHERE id = $2`,
              [newExpiry.toISOString(), existing.rows[0].id]);
            console.log(`[Pay] 🔄 Premium extended for ${row.email} → ${newExpiry.toISOString()}`);
          } else {
            // NEW: 30 days from now
            newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          }
          // Activate the pending record
          await db.query(
            `UPDATE premium_activations SET status = 'verified', activated_at = NOW(), expires_at = $1
             WHERE id = $2`,
            [newExpiry.toISOString(), row.id]
          );
          console.log(`[Pay] 🎉 Premium activated for ${row.email} (expires ${newExpiry.toISOString()})`);
        }
      } catch (e) { console.log('[Pay] Premium activation skipped:', e.message); }
    }
  }

  console.log(`[Pay] ${txStatus === 'VERIFIED' ? '✅' : '❌'} ${orderTrackingId} → ${txStatus}`);
  json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
}

// GET /api/payment/check-premium?email=... — Check premium status
// If already active, EXTENDS the expiry by 30 days (supports repeat payments).
async function handleCheckPremium(req, res, url) {
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return json(res, 400, { ok: false, error: 'Valid email required' });
  }

  const db = getDb();
  if (!db) {
    return json(res, 200, { ok: true, active: false, message: 'Database not available' });
  }

  try {
    await ensureTables(db);

    // Check for verified, non-expired premium
    const r = await db.query(
      `SELECT id, activated_at, expires_at FROM premium_activations
       WHERE LOWER(email) = $1 AND status = 'verified' AND expires_at > NOW()
       ORDER BY activated_at DESC LIMIT 1`,
      [email]
    );
    if (r.rows.length > 0) {
      const row = r.rows[0];
      return json(res, 200, {
        ok: true,
        active: true,
        activatedAt: row.activated_at,
        expiresAt: row.expires_at,
      });
    }

    // Fallback: check transactions table for premium marker
    const r2 = await db.query(
      `SELECT stk_response_description FROM transactions
       WHERE account_reference LIKE $1 AND status = 'VERIFIED'
       ORDER BY created_at DESC LIMIT 1`,
      ['%' + email + '%']
    );
    if (r2.rows.length > 0 && r2.rows[0].stk_response_description?.includes('PREMIUM_ACTIVATED')) {
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      return json(res, 200, { ok: true, active: true, activatedAt: new Date(), expiresAt: new Date(expiresAt) });
    }
  } catch (e) { console.log('[Pay] check-premium error:', e.message); }

  json(res, 200, { ok: true, active: false });
}

// POST /api/payment — Record a payment reference (general)
async function handleInitialize(req, res) {
  const body = await readBody(req);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'Valid amount required' });
  }

  const txRef = body.tx_ref || generateTxRef();
  const amount = Math.round(Number(body.amount));
  const title = body.title || 'GlitchIt Payment';
  const buyerName = body.name || body.buyer_name || '';
  const buyerEmail = body.email || body.buyer_email || '';

  const db = getDb();
  if (db) {
    try {
      await db.query(
        `INSERT INTO transactions (id, merchant_id, checkout_request_id, amount, phone_number,
         account_reference, status, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, $2, $3, $4, 'PENDING', NOW(), NOW())
         ON CONFLICT (checkout_request_id) DO NOTHING`,
        [txRef, amount, buyerName || buyerEmail || '', title]
      );
    } catch (e) { console.log('[Pay] DB insert skipped:', e.message); }
  }

  console.log(`[Pay] 📤 Payment recorded: $${amount} ref=${txRef}`);
  return json(res, 200, {
    ok: true,
    tx_ref: txRef,
    status: 'recorded',
    message: 'Payment reference recorded. Complete payment on the PesaPal checkout page.',
  });
}

// POST /api/payment/submit — Customer submits confirmation code
async function handleSubmit(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  if (!body.mpesa_code || !/^[A-Z0-9]{8,14}$/i.test(body.mpesa_code.trim())) {
    return json(res, 400, { ok: false, error: 'Enter a valid code (8-14 characters)' });
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

  console.log(`[Pay] 📱 Code: ${body.tx_ref} → ${body.mpesa_code}`);
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'submitted', message: 'Code received. Pending verification.' });
}

// POST /api/payment/verify — Check status (client polls)
async function handleVerify(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });

  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        'SELECT status, amount, mpesa_receipt_number FROM transactions WHERE checkout_request_id = $1',
        [body.tx_ref]
      );
      if (result.rows.length > 0) {
        const tx = result.rows[0];
        if (tx.status === 'VERIFIED') return json(res, 200, { ok: true, status: 'verified', amount: Number(tx.amount), tx_ref: body.tx_ref, receipt: tx.mpesa_receipt_number });
        if (tx.status === 'CANCELLED' || tx.status === 'FAILED') return json(res, 200, { ok: false, status: tx.status.toLowerCase(), error: `Payment ${tx.status.toLowerCase()}` });
        return json(res, 202, { ok: false, status: tx.status.toLowerCase(), pending: true, message: 'Waiting...' });
      }
    } catch (e) { /* ignore */ }
  }
  json(res, 202, { ok: false, status: 'pending', pending: true });
}

// GET /api/payment/verify?tx_ref=...
async function handleVerifyGet(req, res, url) {
  const txRef = url.searchParams.get('tx_ref');
  if (!txRef) return json(res, 400, { ok: false, error: 'tx_ref required' });

  const db = getDb();
  if (db) {
    try {
      const r = await db.query('SELECT status, amount FROM transactions WHERE checkout_request_id = $1', [txRef]);
      if (r.rows.length > 0 && r.rows[0].status === 'VERIFIED') {
        return json(res, 200, { ok: true, status: 'verified', amount: Number(r.rows[0].amount), tx_ref: txRef });
      }
    } catch (e) { /* ignore */ }
  }
  json(res, 202, { ok: false, status: 'pending', pending: true });
}

// GET /api/payment/config
function handleConfig(req, res) {
  json(res, 200, {
    ok: true,
    business_name: getBusinessName(),
    mode: 'store-link',
    provider: 'pesapal-store',
  });
}

// POST /api/payment/approve — Owner approves (admin-only)
async function handleApprove(req, res) {
  const denied = requireAdminSecret(req);
  if (denied) return json(res, denied.status, denied.body);
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  const db = getDb();
  if (db) {
    try {
      await db.query(`UPDATE transactions SET status = 'VERIFIED', updated_at = NOW() WHERE checkout_request_id = $1`, [body.tx_ref]);
    } catch (e) { /* ignore */ }
  }
  console.log(`[Pay] ✅ Approved: ${body.tx_ref}`);
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'verified' });
}

// POST /api/payment/reject (admin-only)
async function handleReject(req, res) {
  const denied = requireAdminSecret(req);
  if (denied) return json(res, denied.status, denied.body);
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  const db = getDb();
  if (db) {
    try {
      await db.query(`UPDATE transactions SET status = 'REJECTED', updated_at = NOW() WHERE checkout_request_id = $1`, [body.tx_ref]);
    } catch (e) { /* ignore */ }
  }
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'rejected' });
}

// GET /api/payment/pending (admin-only)
async function handlePending(req, res) {
  const denied = requireAdminSecret(req);
  if (denied) return json(res, denied.status, denied.body);
  const db = getDb();
  if (!db) return json(res, 200, { ok: true, count: 0, transactions: [] });
  try {
    const r = await db.query(
      `SELECT checkout_request_id, amount, phone_number, status,
       stk_response_description as code, mpesa_receipt_number as receipt, created_at
       FROM transactions WHERE status NOT IN ('VERIFIED','REJECTED')
       ORDER BY created_at DESC LIMIT 50`
    );
    json(res, 200, { ok: true, count: r.rows.length, transactions: r.rows });
  } catch (e) {
    json(res, 200, { ok: true, count: 0, transactions: [] });
  }
}

// ─── Router ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (method === 'POST' && path === '/api/payment/premium-init') return handlePremiumInit(req, res);
  if (method === 'POST' && path === '/api/payment/ipn') return handleIPN(req, res);
  if (method === 'POST' && path === '/api/payment/callback') return handleIPN(req, res);
  if (method === 'POST' && path === '/api/payment') return handleInitialize(req, res);
  if (method === 'POST' && path === '/api/payment/submit') return handleSubmit(req, res);
  if (method === 'POST' && path === '/api/payment/verify') return handleVerify(req, res);
  if (method === 'GET' && path === '/api/payment/verify') return handleVerifyGet(req, res, url);
  if (method === 'GET' && path === '/api/payment/config') return handleConfig(req, res);
  if (method === 'POST' && path === '/api/payment/approve') return handleApprove(req, res);
  if (method === 'POST' && path === '/api/payment/reject') return handleReject(req, res);
  if (method === 'GET' && path === '/api/payment/check-premium') return handleCheckPremium(req, res, url);
  if (method === 'GET' && path === '/api/payment/pending') return handlePending(req, res);

  json(res, 405, { ok: false, error: 'Method not allowed' });
};
