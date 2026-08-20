// GlitchIt Pay — real STK push via Safaricom Daraja API
// Sends actual M-Pesa prompt to user's phone. They see "Pay KES X" and enter PIN.
'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');

// ─── Configuration (read lazily so env vars injected after startup are picked up) ──
function cfg(key, fallback) { return process.env[key] || fallback; }
function getDarajaKey()    { return cfg('DARAJA_CONSUMER_KEY', ''); }
function getDarajaSecret() { return cfg('DARAJA_CONSUMER_SECRET', ''); }
function getDarajaShortcode() { return cfg('DARAJA_SHORTCODE', '174379'); }
function getDarajaPasskey()   { return cfg('DARAJA_PASSKEY', 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'); }
function getDarajaEnv()    { return cfg('DARAJA_ENV', 'sandbox'); }
function getMpesaNumber()  { return cfg('PAYMENT_MPESA_NUMBER', '0143476934'); }
function getBusinessName() { return cfg('PAYMENT_BUSINESS_NAME', 'GlitchIt'); }
function getDatabaseUrl()  { return cfg('DATABASE_URL', ''); }
function getRedisUrl()     { return cfg('REDIS_URL', ''); }

function getDarajaBase() {
  return getDarajaEnv() === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// ─── Database ───────────────────────────────────────────────────────
let dbPool = null;
function getDb() {
  if (!dbPool && getDatabaseUrl()) {
    dbPool = new Pool({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    dbPool.on('error', (err) => console.error('[Pay/DB]', err.message));
  }
  return dbPool;
}

// ─── Redis (token cache) ────────────────────────────────────────────
let redis = null;
let redisFailed = false;
function getRedis() {
  if (redisFailed) return null;
  if (!redis && getRedisUrl()) {
    try {
      redis = new Redis(getRedisUrl(), { maxRetriesPerRequest: 0, enableReadyCheck: true, connectTimeout: 3000, lazyConnect: true, commandTimeout: 2000 });
      redis.on('error', () => { redisFailed = true; try { redis?.disconnect?.(); } catch(e) {} redis = null; });
      redis.connect().catch(() => { redisFailed = true; redis = null; });
    } catch(e) { redisFailed = true; return null; }
  }
  return redis;
}

function redisGet(key) {
  return new Promise((resolve) => {
    const r = getRedis();
    if (!r) return resolve(null);
    const timer = setTimeout(() => resolve(null), 2000);
    r.get(key).then((v) => { clearTimeout(timer); resolve(v); }).catch(() => { clearTimeout(timer); resolve(null); });
  });
}
function redisSet(key, val, exSec) {
  return new Promise((resolve) => {
    const r = getRedis();
    if (!r) return resolve();
    const timer = setTimeout(() => resolve(), 2000);
    r.set(key, val, 'EX', exSec).then(() => { clearTimeout(timer); resolve(); }).catch(() => { clearTimeout(timer); resolve(); });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
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
  if (d.startsWith('254')) d = d.slice(3);
  d = d.replace(/^0+/, '');
  if (d.length >= 9) return '254' + d.slice(-9);
  return '254' + d.padStart(9, '0');
}

function generateTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function generatePassword(ts) {
  return Buffer.from(`${getDarajaShortcode()}${getDarajaPasskey()}${ts}`).toString('base64');
}

// ─── OAuth Token (cached in Redis) ──────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  // Try Redis cache (with timeout)
  const cached = await redisGet('mpesa:oauth:token');
  if (cached) { cachedToken = cached; tokenExpiry = Date.now() + 3500000; return cached; }

  if (!getDarajaKey() || !getDarajaSecret()) throw new Error('Daraja credentials not configured');

  const auth = Buffer.from(`${getDarajaKey()}:${getDarajaSecret()}`).toString('base64');
  const res = await fetch(`${getDarajaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`OAuth HTTP ${res.status}`);
  const data = await res.json();
  const token = data.access_token;
  if (!token) throw new Error('No access_token');

  cachedToken = token;
  tokenExpiry = Date.now() + 3500000;

  // Cache in Redis
  await redisSet('mpesa:oauth:token', token, 3500);

  return token;
}

// ─── Send STK Push ──────────────────────────────────────────────────
async function sendStkPush(phoneNumber, amount, txRef) {
  const token = await getAccessToken();
  const ts = generateTimestamp();
  const password = generatePassword(ts);

  const phone = formatPhone(phoneNumber);

  const payload = {
    BusinessShortCode: getDarajaShortcode(),
    Password: password,
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: getDarajaShortcode(),
    PhoneNumber: phone,
    CallBackURL: 'https://glitchit.app/api/payment/callback',
    AccountReference: txRef.slice(0, 12),
    TransactionDesc: `Pay ${getBusinessName()}`,
  };

  console.log(`[Pay] 📤 STK Push → ${phone} KES ${amount} ref=${txRef}`);

  const res = await fetch(`${getDarajaBase()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  const data = await res.json();
  console.log(`[Pay] Daraja response:`, JSON.stringify(data).slice(0, 300));

  return data;
}

// ─── Route Handlers ─────────────────────────────────────────────────

// POST /api/payment — Initialize payment & send STK push
async function handleInitialize(req, res) {
  const body = await readBody(req);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'Valid amount required' });
  }

  const txRef = body.tx_ref || generateTxRef();
  const amount = Math.round(Number(body.amount));
  const phone = body.phone || '';
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
        [txRef, amount, formatPhone(phone), title]
      );
    } catch(e) { console.log('[Pay] DB insert skipped:', e.message); }
  }

  // Check if Daraja credentials are available
  if (!getDarajaKey() || !getDarajaSecret()) {
    console.log(`[Pay] ⚠️ No Daraja credentials — showing instructions instead of STK push`);
    return json(res, 200, {
      ok: true,
      tx_ref: txRef,
      status: 'instructions',
      message: 'STK credentials not configured. Pay manually using the instructions below.',
      instructions: {
        mpesa_number: getMpesaNumber(),
        amount: amount,
        currency: 'KES',
        reference: txRef,
        business_name: getBusinessName(),
        steps: [
          `Open M-Pesa → Lipa na M-Pesa → Pay Bill`,
          `Business Number: ${getMpesaNumber()}`,
          `Amount: KES ${amount.toLocaleString()}`,
          `Reference: ${txRef}`,
          `Confirm with PIN`,
          `Enter the SMS confirmation code below`,
        ],
      },
    });
  }

  // Send real STK push
  try {
    const stkResult = await sendStkPush(phone, amount, txRef);

    if (stkResult.ResponseCode === '0' || stkResult.ResponseCode === '00') {
      // STK push sent successfully
      const db2 = getDb();
      if (db2) {
        try {
          await db2.query(
            `UPDATE transactions SET stk_response_description = $1, status = 'STK_SENT', updated_at = NOW() WHERE checkout_request_id = $2`,
            [stkResult.CustomerMessage || 'STK push sent', txRef]
          );
        } catch(e) {}
      }

      console.log(`[Pay] ✅ STK push sent — CheckoutRequestID: ${stkResult.CheckoutRequestID}`);

      return json(res, 200, {
        ok: true,
        tx_ref: txRef,
        status: 'stk_sent',
        message: stkResult.CustomerMessage || 'Check your phone for the M-Pesa prompt',
        checkout_request_id: stkResult.CheckoutRequestID,
      });
    } else {
      // STK push failed
      console.log(`[Pay] ❌ STK push failed: ${stkResult.ResponseCode} — ${stkResult.ResponseDescription}`);

      const db3 = getDb();
      if (db3) {
        try {
          await db3.query(
            `UPDATE transactions SET stk_response_description = $1, status = 'STK_FAILED', updated_at = NOW() WHERE checkout_request_id = $2`,
            [stkResult.ResponseDescription || 'STK push failed', txRef]
          );
        } catch(e) {}
      }

      // Fall back to manual instructions
      return json(res, 200, {
        ok: true,
        tx_ref: txRef,
        status: 'instructions',
        message: 'STK push could not be sent. Please pay manually.',
        instructions: {
          mpesa_number: getMpesaNumber(),
          amount: amount,
          currency: 'KES',
          reference: txRef,
          business_name: getBusinessName(),
          steps: [
            `Open M-Pesa → Lipa na M-Pesa → Pay Bill`,
            `Business Number: ${getMpesaNumber()}`,
            `Amount: KES ${amount.toLocaleString()}`,
            `Reference: ${txRef}`,
            `Confirm with PIN`,
            `Enter the SMS confirmation code below`,
          ],
        },
      });
    }
  } catch (err) {
    console.error(`[Pay] STK push error:`, err.message);

    // Fall back to manual instructions
    return json(res, 200, {
      ok: true,
      tx_ref: txRef,
      status: 'instructions',
      message: 'STK push unavailable. Please pay manually.',
      instructions: {
        mpesa_number: getMpesaNumber(),
        amount: amount,
        currency: 'KES',
        reference: txRef,
        business_name: getBusinessName(),
        steps: [
          `Open M-Pesa → Lipa na M-Pesa → Pay Bill`,
          `Business Number: ${getMpesaNumber()}`,
          `Amount: KES ${amount.toLocaleString()}`,
          `Reference: ${txRef}`,
          `Confirm with PIN`,
          `Enter the SMS confirmation code below`,
        ],
      },
    });
  }
}

// POST /api/payment/callback — Daraja callback (Safaricom calls this)
async function handleCallback(req, res) {
  console.log(`[Pay] 📥 Callback received`);

  const body = await readBody(req);
  const stk = body?.Body?.stkCallback;

  if (!stk) return json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;
  console.log(`[Pay] Callback: ${CheckoutRequestID} code=${ResultCode}`);

  // Extract receipt number
  let receipt = null;
  if (CallbackMetadata?.Item) {
    for (const item of CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber') receipt = String(item.Value);
    }
  }

  const status = ResultCode === 0 ? 'VERIFIED' : ResultCode === 1032 ? 'CANCELLED' : 'FAILED';

  const db = getDb();
  if (db) {
    try {
      await db.query(
        `UPDATE transactions SET status = $1, mpesa_receipt_number = $2, stk_response_description = $3, updated_at = NOW()
         WHERE checkout_request_id = $4`,
        [status, receipt, ResultDesc, CheckoutRequestID]
      );
    } catch(e) {}
  }

  console.log(`[Pay] ${status === 'VERIFIED' ? '✅' : '❌'} ${CheckoutRequestID} receipt=${receipt || 'N/A'}`);

  json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
}

// POST /api/payment/submit — Customer submits confirmation code (fallback)
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
      const result = await db.query('SELECT status, amount, mpesa_receipt_number FROM transactions WHERE checkout_request_id = $1', [body.tx_ref]);
      if (result.rows.length > 0) {
        const tx = result.rows[0];
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
  json(res, 200, { ok: true, mpesa_number: getMpesaNumber(), business_name: getBusinessName(), mode: getDarajaKey() ? 'live' : 'manual' });
}

// POST /api/payment/approve — Owner approves
async function handleApprove(req, res) {
  const body = await readBody(req);
  if (!body || !body.tx_ref) return json(res, 400, { ok: false, error: 'tx_ref required' });
  const db = getDb();
  if (db) { try { await db.query(`UPDATE transactions SET status = 'VERIFIED', updated_at = NOW() WHERE checkout_request_id = $1`, [body.tx_ref]); } catch(e) {} }
  console.log(`[Pay] ✅ Approved: ${body.tx_ref}`);
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
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (method === 'POST' && path === '/api/payment') return handleInitialize(req, res);
  if (method === 'POST' && path === '/api/payment/callback') return handleCallback(req, res);
  if (method === 'POST' && path === '/api/payment/submit') return handleSubmit(req, res);
  if (method === 'POST' && path === '/api/payment/verify') return handleVerify(req, res);
  if (method === 'GET' && path === '/api/payment/verify') return handleVerifyGet(req, res, url);
  if (method === 'GET' && path === '/api/payment/config') return handleConfig(req, res);
  if (method === 'POST' && path === '/api/payment/approve') return handleApprove(req, res);
  if (method === 'POST' && path === '/api/payment/reject') return handleReject(req, res);
  if (method === 'GET' && path === '/api/payment/pending') return handlePending(req, res);

  json(res, 405, { ok: false, error: 'Method not allowed' });
};
