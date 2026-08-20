// GlitchIt Pay — PesaPal API 3.0 integration for M-Pesa STK push
// When a phone number is provided in billing_address, PesaPal sends the
// STK push prompt to the customer's phone automatically.
//
// Required env vars (Freebuff Settings → Environment):
//   PESAPAL_CONSUMER_KEY    — from PesaPal developer dashboard
//   PESAPAL_CONSUMER_SECRET — from PesaPal developer dashboard
//   PESAPAL_ENV             — 'sandbox' (default) or 'production'
//   PAYMENT_BUSINESS_NAME   — display name (default: 'GlitchIt')
//   DATABASE_URL            — PostgreSQL for transaction persistence (optional, graceful fallback)
//   REDIS_URL               — Redis for token caching (optional, graceful fallback)
'use strict';

const crypto = require('node:crypto');
let Pool, Redis;
try { Pool = require('pg').Pool; } catch (e) { /* pg optional */ }
try { Redis = require('ioredis'); } catch (e) { /* ioredis optional */ }

// ─── Configuration (lazy — env vars may be injected after startup) ──
function cfg(k, fb) { return process.env[k] || fb; }
function getPesapalKey()     { return cfg('PESAPAL_CONSUMER_KEY', ''); }
function getPesapalSecret()  { return cfg('PESAPAL_CONSUMER_SECRET', ''); }
function getPesapalEnv()     { return cfg('PESAPAL_ENV', 'sandbox'); }
function getBusinessName()   { return cfg('PAYMENT_BUSINESS_NAME', 'GlitchIt'); }
function getDatabaseUrl()    { return cfg('DATABASE_URL', ''); }
function getRedisUrl()       { return cfg('REDIS_URL', ''); }

function getPesapalBase() {
  return getPesapalEnv() === 'production'
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3';
}

function getCallbackUrl() {
  const publicUrl = cfg('PUBLIC_URL', cfg('VERCEL_URL', ''));
  const base = publicUrl ? (publicUrl.startsWith('http') ? publicUrl : `https://${publicUrl}`) : 'https://glitchit.app';
  return `${base}/api/payment/ipn`;
}

// ─── Database (optional, graceful) ──────────────────────────────────
let dbPool = null;
function getDb() {
  if (!Pool || !getDatabaseUrl()) return null;
  if (!dbPool) {
    try {
      dbPool = new Pool({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
      dbPool.on('error', (err) => console.error('[Pay/DB]', err.message));
    } catch (e) { return null; }
  }
  return dbPool;
}

// ─── Redis (optional, graceful) ─────────────────────────────────────
let redis = null;
let redisFailed = false;
function getRedis() {
  if (redisFailed || !Redis) return null;
  if (!redis && getRedisUrl()) {
    try {
      redis = new Redis(getRedisUrl(), { maxRetriesPerRequest: 0, enableReadyCheck: true, connectTimeout: 3000, lazyConnect: true, commandTimeout: 2000 });
      redis.on('error', () => { redisFailed = true; try { redis?.disconnect?.(); } catch(e) {} redis = null; });
      redis.connect().catch(() => { redisFailed = true; redis = null; });
    } catch(e) { redisFailed = true; return null; }
  }
  return redis;
}

async function redisGet(key) {
  return new Promise((resolve) => {
    const r = getRedis();
    if (!r) return resolve(null);
    const t = setTimeout(() => resolve(null), 2000);
    r.get(key).then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(null); });
  });
}
async function redisSet(key, val, exSec) {
  return new Promise((resolve) => {
    const r = getRedis();
    if (!r) return resolve();
    const t = setTimeout(() => resolve(), 2000);
    r.set(key, val, 'EX', exSec).then(() => { clearTimeout(t); resolve(); }).catch(() => { clearTimeout(t); resolve(null); });
  });
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
    req.on('data', (c) => { size += c.length; if (size > 1024*1024) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function generateTxRef() {
  return `GLT-${Date.now().toString(36).slice(-6).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function formatPhone(phone) {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('+254')) d = d.slice(1);
  if (d.startsWith('254')) { /* ok */ }
  else if (d.startsWith('0')) d = '254' + d.slice(1);
  else if (d.length <= 9) d = '254' + d;
  if (!/^254[17]\d{8}$/.test(d)) return null;
  return d;
}

// ─── PesaPal OAuth Token (cached in Redis) ──────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getPesaPalToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const cached = await redisGet('pesapal:token');
  if (cached) { cachedToken = cached; tokenExpiry = Date.now() + 3500000; return cached; }

  const key = getPesapalKey();
  const secret = getPesapalSecret();
  if (!key || !secret) throw new Error('PesaPal credentials not configured (PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET)');

  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(`${getPesapalBase()}/api/Auth/GetToken`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`PesaPal auth HTTP ${res.status}`);
  const data = await res.json();

  if (data.status === '200' && data.token) {
    cachedToken = data.token;
    // PesaPal tokens expire in ~1 hour; cache for 50 min
    tokenExpiry = Date.now() + 3000000;
    await redisSet('pesapal:token', cachedToken, 2900);
    return cachedToken;
  }

  throw new Error(`PesaPal auth failed: ${data.error || data.message || JSON.stringify(data)}`);
}

// ─── Submit Order (triggers STK push when phone_number is provided) ─
async function submitOrder({ txRef, amount, phone, email, description }) {
  const token = await getPesaPalToken();
  const phoneFormatted = formatPhone(phone);

  const payload = {
    id: txRef,
    currency: 'USD',
    amount: Math.round(amount * 100) / 100,
    description: description || `Pay ${getBusinessName()}`,
    callback_url: getCallbackUrl(),
    redirect_mode: 'TOP',
    billing_address: {
      phone_number: phoneFormatted || '',
      email: email || 'customer@glitchit.app',
      country_code: 'KE',
    },
  };

  console.log(`[Pay/PesaPal] 📤 SubmitOrder → ${phoneFormatted} $${amount} ref=${txRef}`);

  const res = await fetch(`${getPesapalBase()}/api/Orders/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  const data = await res.json();
  console.log(`[Pay/PesaPal] Response:`, JSON.stringify(data).slice(0, 400));
  return data;
}

// ─── Check Transaction Status ───────────────────────────────────────
async function getTransactionStatus(orderTrackingId) {
  const token = await getPesaPalToken();
  const res = await fetch(`${getPesapalBase()}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return res.json();
}

// ─── Route Handlers ─────────────────────────────────────────────────

// POST /api/payment — Initialize payment & trigger STK push via PesaPal
async function handleInitialize(req, res) {
  const body = await readBody(req);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'Valid amount required' });
  }

  const txRef = body.tx_ref || generateTxRef();
  const amount = Math.round(Number(body.amount));
  const phone = body.phone || '';
  const email = body.email || '';
  const title = body.title || 'GlitchIt Payment';

  if (!phone || phone.replace(/\D/g, '').length < 9) {
    return json(res, 400, { ok: false, error: 'Valid phone number required' });
  }

  // Store in DB
  const db = getDb();
  if (db) {
    try {
      await db.query(
        `INSERT INTO transactions (id, merchant_id, checkout_request_id, amount, phone_number, account_reference, status, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, $2, $3, $4, 'PENDING', NOW(), NOW())
         ON CONFLICT (checkout_request_id) DO NOTHING`,
        [txRef, amount, formatPhone(phone) || phone, title]
      );
    } catch(e) { console.log('[Pay/PesaPal] DB insert skipped:', e.message); }
  }

  // Check if PesaPal credentials are available
  if (!getPesapalKey() || !getPesapalSecret()) {
    console.log(`[Pay/PesaPal] ⚠️ No PesaPal credentials — showing instructions instead of STK push`);
    return json(res, 200, {
      ok: true,
      tx_ref: txRef,
      status: 'instructions',
      message: 'Payment credentials not configured. Pay manually using the instructions below.',
      instructions: {
        mpesa_number: cfg('PAYMENT_MPESA_NUMBER', '0757011200'),
        amount: amount,
        currency: 'USD',
        reference: txRef,
        business_name: getBusinessName(),
        steps: [
          `Open M-Pesa → Lipa na M-Pesa → Pay Bill`,
          `Business Number: ${cfg('PAYMENT_MPESA_NUMBER', '0757011200')}`,
          `Amount: $${amount.toLocaleString()}`,
          `Reference: ${txRef}`,
          `Confirm with PIN`,
          `Enter the SMS confirmation code below`,
        ],
      },
    });
  }

  // Submit order to PesaPal (this triggers the STK push)
  try {
    const result = await submitOrder({
      txRef,
      amount,
      phone,
      email,
      description: title,
    });

    if (result.status === '200' && result.order_tracking_id) {
      // STK push sent — PesaPal will call our IPN URL when payment completes
      const db2 = getDb();
      if (db2) {
        try {
          await db2.query(
            `UPDATE transactions SET stk_response_description = $1, status = 'STK_SENT', updated_at = NOW() WHERE checkout_request_id = $2`,
            [result.order_tracking_id, txRef]
          );
        } catch(e) {}
      }

      console.log(`[Pay/PesaPal] ✅ Order created — tracking: ${result.order_tracking_id}`);

      return json(res, 200, {
        ok: true,
        tx_ref: txRef,
        status: 'stk_sent',
        order_tracking_id: result.order_tracking_id,
        message: 'Check your phone for the M-Pesa prompt',
        redirect_url: result.redirect_url || null,
      });
    } else {
      // PesaPal returned an error
      console.log(`[Pay/PesaPal] ❌ Order failed: ${result.error || result.status}`);

      const db3 = getDb();
      if (db3) {
        try {
          await db3.query(
            `UPDATE transactions SET stk_response_description = $1, status = 'STK_FAILED', updated_at = NOW() WHERE checkout_request_id = $2`,
            [result.error || 'Order submission failed', txRef]
          );
        } catch(e) {}
      }

      // Fall back to manual instructions
      return json(res, 200, {
        ok: true,
        tx_ref: txRef,
        status: 'instructions',
        message: 'Online payment unavailable. Please pay manually.',
        instructions: {
          mpesa_number: cfg('PAYMENT_MPESA_NUMBER', '0757011200'),
          amount: amount,
          currency: 'USD',
          reference: txRef,
          business_name: getBusinessName(),
          steps: [
            `Open M-Pesa → Lipa na M-Pesa → Pay Bill`,
            `Business Number: ${cfg('PAYMENT_MPESA_NUMBER', '0757011200')}`,
            `Amount: $${amount.toLocaleString()}`,
            `Reference: ${txRef}`,
            `Confirm with PIN`,
            `Enter the SMS confirmation code below`,
          ],
        },
      });
    }
  } catch (err) {
    console.error(`[Pay/PesaPal] ❌ Error:`, err.message);

    // Fall back to manual instructions
    return json(res, 200, {
      ok: true,
      tx_ref: txRef,
      status: 'instructions',
      message: 'Online payment unavailable. Please pay manually.',
      instructions: {
        mpesa_number: cfg('PAYMENT_MPESA_NUMBER', '0757011200'),
        amount: amount,
        currency: 'USD',
        reference: txRef,
        business_name: getBusinessName(),
        steps: [
          `Open M-Pesa → Lipa na M-Pesa → Pay Bill`,
          `Business Number: ${cfg('PAYMENT_MPESA_NUMBER', '0757011200')}`,
          `Amount: $${amount.toLocaleString()}`,
          `Reference: ${txRef}`,
          `Confirm with PIN`,
          `Enter the SMS confirmation code below`,
        ],
      },
    });
  }
}

// POST /api/payment/ipn — PesaPal IPN (Instant Payment Notification) callback
async function handleIPN(req, res) {
  console.log(`[Pay/PesaPal] 📥 IPN received`);

  const body = await readBody(req);
  if (!body) return json(res, 200, { ok: true });

  const orderTrackingId = body.order_tracking_id || body.OrderTrackingId;
  const merchantRef = body.merchant_reference || body.MerchantReference;
  const status = (body.status || body.Status || '').toUpperCase();

  console.log(`[Pay/PesaPal] IPN: ${orderTrackingId} ref=${merchantRef} status=${status}`);

  if (!orderTrackingId && !merchantRef) return json(res, 200, { ok: true });

  // Map PesaPal status to our internal status
  let txStatus = 'PENDING';
  if (status === 'SUCCESS') txStatus = 'VERIFIED';
  else if (status === 'FAILED' || status === 'INVALID') txStatus = 'FAILED';
  else if (status === 'CANCELLED') txStatus = 'CANCELLED';

  // If PesaPal says SUCCESS, verify via their API (belt and suspenders)
  if (txStatus === 'VERIFIED' && orderTrackingId) {
    try {
      const verification = await getTransactionStatus(orderTrackingId);
      if (verification) {
        const verifyStatus = (verification.payment_status || verification.status || '').toUpperCase();
        if (verifyStatus !== 'COMPLETED' && verifyStatus !== 'SUCCESS') {
          console.log(`[Pay/PesaPal] ⚠️ Verification shows: ${verifyStatus} — overriding to ${verifyStatus}`);
          if (verifyStatus === 'FAILED' || verifyStatus === 'INVALID') txStatus = 'FAILED';
        }
      }
    } catch(e) { console.log('[Pay/PesaPal] Verification failed:', e.message); }
  }

  const db = getDb();
  if (db) {
    const lookupRef = orderTrackingId || merchantRef;
    try {
      const r = await db.query(
        `UPDATE transactions SET status = $1, stk_response_description = COALESCE(stk_response_description, $2), updated_at = NOW()
         WHERE checkout_request_id = $3 OR stk_response_description = $3
         RETURNING id`,
        [txStatus, orderTrackingId || '', lookupRef]
      );
      if (r.rows.length === 0) {
        // Transaction might not exist in DB — create it
        await db.query(
          `INSERT INTO transactions (id, merchant_id, checkout_request_id, amount, phone_number, account_reference, status, stk_response_description, updated_at, created_at)
           VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, 0, '', '', $2, $3, NOW(), NOW())
           ON CONFLICT (checkout_request_id) DO UPDATE SET status = $2, updated_at = NOW()`,
          [merchantRef || orderTrackingId, txStatus, orderTrackingId || '']
        );
      }
    } catch(e) { console.log('[Pay/PesaPal] DB update skipped:', e.message); }
  }

  console.log(`[Pay/PesaPal] ${txStatus === 'VERIFIED' ? '✅' : '❌'} ${orderTrackingId} → ${txStatus}`);
  json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
}

// POST /api/payment/submit — Customer submits confirmation code (manual fallback)
async function handleSubmit(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  if (!body.mpesa_code || !/^[A-Z0-9]{8,14}$/i.test(body.mpesa_code.trim())) {
    return json(res, 400, { ok: false, error: 'Enter a valid M-Pesa code (8-14 characters)' });
  }

  const db = getDb();
  if (db) {
    try {
      await db.query(
        `UPDATE transactions SET stk_response_description = $1, status = 'SUBMITTED', updated_at = NOW() WHERE checkout_request_id = $2`,
        [body.mpesa_code.trim().toUpperCase(), body.tx_ref]
      );
    } catch(e) {}
  }

  console.log(`[Pay/PesaPal] 📱 Code: ${body.tx_ref} → ${body.mpesa_code}`);
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'submitted', message: 'Code received. Pending verification.' });
}

// POST /api/payment/verify — Check status (client polls)
async function handleVerify(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });

  // Try PesaPal API first if we have an order_tracking_id
  const db = getDb();
  if (db) {
    try {
      const result = await db.query(
        'SELECT status, amount, mpesa_receipt_number, stk_response_description FROM transactions WHERE checkout_request_id = $1',
        [body.tx_ref]
      );
      if (result.rows.length > 0) {
        const tx = result.rows[0];

        // If we have an order_tracking_id, try PesaPal verification
        if (tx.stk_response_description && tx.stk_response_description.startsWith('PP-')) {
          try {
            const pesapalStatus = await getTransactionStatus(tx.stk_response_description);
            if (pesapalStatus) {
              const ps = (pesapalStatus.payment_status || '').toUpperCase();
              if (ps === 'COMPLETED' || ps === 'SUCCESS') {
                await db.query(
                  `UPDATE transactions SET status = 'VERIFIED', mpesa_receipt_number = COALESCE(mpesa_receipt_number, stk_response_description), updated_at = NOW() WHERE checkout_request_id = $1`,
                  [body.tx_ref]
                );
                return json(res, 200, { ok: true, status: 'verified', amount: Number(tx.amount), tx_ref: body.tx_ref, receipt: tx.mpesa_receipt_number || tx.stk_response_description });
              } else if (ps === 'FAILED' || ps === 'INVALID') {
                await db.query(`UPDATE transactions SET status = 'FAILED', updated_at = NOW() WHERE checkout_request_id = $1`, [body.tx_ref]);
                return json(res, 200, { ok: false, status: 'failed', error: 'Payment failed' });
              }
            }
          } catch(e) { /* fall through to DB status */ }
        }

        if (tx.status === 'VERIFIED') return json(res, 200, { ok: true, status: 'verified', amount: Number(tx.amount), tx_ref: body.tx_ref, receipt: tx.mpesa_receipt_number });
        if (tx.status === 'CANCELLED' || tx.status === 'FAILED') return json(res, 200, { ok: false, status: tx.status.toLowerCase(), error: `Payment ${tx.status.toLowerCase()}` });
        return json(res, 202, { ok: false, status: tx.status.toLowerCase(), pending: true, message: 'Waiting...' });
      }
    } catch(e) {}
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
    } catch(e) {}
  }
  json(res, 202, { ok: false, status: 'pending', pending: true });
}

// GET /api/payment/config
function handleConfig(req, res) {
  json(res, 200, {
    ok: true,
    mpesa_number: cfg('PAYMENT_MPESA_NUMBER', '0757011200'),
    business_name: getBusinessName(),
    mode: getPesapalKey() ? 'live' : 'manual',
    provider: 'pesapal',
  });
}

// POST /api/payment/approve — Owner approves
async function handleApprove(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  const db = getDb();
  if (db) { try { await db.query(`UPDATE transactions SET status = 'VERIFIED', updated_at = NOW() WHERE checkout_request_id = $1`, [body.tx_ref]); } catch(e) {} }
  console.log(`[Pay/PesaPal] ✅ Approved: ${body.tx_ref}`);
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'verified' });
}

// POST /api/payment/reject
async function handleReject(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  const db = getDb();
  if (db) { try { await db.query(`UPDATE transactions SET status = 'REJECTED', updated_at = NOW() WHERE checkout_request_id = $1`, [body.tx_ref]); } catch(e) {} }
  json(res, 200, { ok: true, tx_ref: body.tx_ref, status: 'rejected' });
}

// GET /api/payment/pending
async function handlePending(req, res) {
  const db = getDb();
  if (!db) return json(res, 200, { ok: true, count: 0, transactions: [] });
  try {
    const r = await db.query(`SELECT checkout_request_id, amount, phone_number, status, stk_response_description as code, mpesa_receipt_number as receipt, created_at FROM transactions WHERE status NOT IN ('VERIFIED','REJECTED') ORDER BY created_at DESC LIMIT 50`);
    json(res, 200, { ok: true, count: r.rows.length, transactions: r.rows });
  } catch(e) { json(res, 200, { ok: true, count: 0, transactions: [] }); }
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (method === 'POST' && path === '/api/payment') return handleInitialize(req, res);
  if (method === 'POST' && path === '/api/payment/ipn') return handleIPN(req, res);
  if (method === 'POST' && path === '/api/payment/callback') return handleIPN(req, res); // alias for backwards compat
  if (method === 'POST' && path === '/api/payment/submit') return handleSubmit(req, res);
  if (method === 'POST' && path === '/api/payment/verify') return handleVerify(req, res);
  if (method === 'GET' && path === '/api/payment/verify') return handleVerifyGet(req, res, url);
  if (method === 'GET' && path === '/api/payment/config') return handleConfig(req, res);
  if (method === 'POST' && path === '/api/payment/approve') return handleApprove(req, res);
  if (method === 'POST' && path === '/api/payment/reject') return handleReject(req, res);
  if (method === 'GET' && path === '/api/payment/pending') return handlePending(req, res);

  json(res, 405, { ok: false, error: 'Method not allowed' });
};
