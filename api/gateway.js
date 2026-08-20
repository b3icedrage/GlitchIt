// ═══════════════════════════════════════════════════════════════════════
// GlitchIt M-Pesa Express Gateway — /v1/* Route Handler
// Vanilla Node.js adapter for integration into server.js
// Always listening — processes payments when merchants call the API
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');

// ─── Configuration ──────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const DARAJA_BASE = (process.env.GATEWAY_DARAJA_ENV || 'sandbox') === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// ─── Database Pool (PostgreSQL) ─────────────────────────────────────
let dbPool = null;

function getDb() {
  if (!dbPool && DATABASE_URL) {
    dbPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    dbPool.on('error', (err) => console.error('[Gateway/DB] Pool error:', err.message));
    console.log('[Gateway/DB] Pool created');
  }
  return dbPool;
}

// ─── Redis Client ───────────────────────────────────────────────────
let redisClient = null;

function getRedis() {
  if (!redisClient && REDIS_URL) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redisClient.on('error', (err) => console.error('[Gateway/Redis] Error:', err.message));
    console.log('[Gateway/Redis] Client created');
  }
  return redisClient;
}

// ─── Crypto Helpers ─────────────────────────────────────────────────
const SALT_ROUNDS = 12;

function generateApiKey(prefix = 'sk', env = 'live') {
  const random = crypto.randomBytes(32).toString('hex');
  return `${prefix}_${env}_${random}`;
}

function derivePublicKey(sk) {
  return sk.replace(/^sk_live_/, 'pk_live_').replace(/^sk_test_/, 'pk_test_');
}

async function hashKey(key) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(key, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(salt + ':' + derived.toString('hex'));
    });
  });
}

async function verifyKey(provided, stored) {
  return new Promise((resolve) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(provided, salt, 64, (err, derived) => {
      if (err) return resolve(false);
      resolve(derived.toString('hex') === hash);
    });
  });
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function generateTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function generatePassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

function generateBasicAuth(key, secret) {
  return Buffer.from(`${key}:${secret}`).toString('base64');
}

function formatPhone(phone) {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return '254' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('254')) return digits;
  if (digits.startsWith('+254')) return digits.slice(1);
  return '254' + digits;
}

function isValidKenyanPhone(phone) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) {
    return /^0(7[0-9]|1[0-2])/.test(d);
  }
  if (d.length === 12 && d.startsWith('254')) {
    return /^254(7[0-9]|1[0-2])/.test(d);
  }
  return false;
}

function maskPhone(phone) {
  const f = formatPhone(phone);
  return f.slice(0, 3) + '****' + f.slice(-4);
}

// ─── OAuth Token Cache (Redis) ─────────────────────────────────────
const TOKEN_CACHE_TTL = 3500;

async function getAccessToken(consumerKey, consumerSecret) {
  const redis = getRedis();
  const cacheKey = `mpesa:oauth:${crypto.createHash('sha256').update(consumerKey).digest('hex').slice(0, 16)}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch (e) { /* Redis unavailable — fetch fresh */ }
  }

  const auth = generateBasicAuth(consumerKey, consumerSecret);
  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Daraja OAuth HTTP ${res.status}`);
  const data = await res.json();
  const token = data.access_config?.access_token || data.access_token;
  if (!token) throw new Error('No access_token in Daraja response');

  if (redis) {
    try { await redis.set(cacheKey, token, 'EX', TOKEN_CACHE_TTL); } catch (e) { /* ignore */ }
  }

  return token;
}

// ─── Request Body Parser ────────────────────────────────────────────
function readBody(req, maxBytes = 1024 * 1024) {
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

// ─── JSON Response Helper ───────────────────────────────────────────
function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function now() { return new Date().toISOString(); }

// ─── Route Handlers ─────────────────────────────────────────────────

// GET /v1/health
function handleHealth(req, res) {
  json(res, 200, {
    status: 'ok',
    service: 'mpesa-express-gateway',
    version: '1.0.0',
    timestamp: now(),
  });
}

// POST /v1/merchants — Register a new merchant
async function handleRegister(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON body', timestamp: now() });

  const required = ['name', 'email', 'phone_number', 'paybill_number', 'consumer_key', 'consumer_secret', 'passkey', 'shortcode', 'callback_url'];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return json(res, 400, { success: false, message: `Missing: ${missing.join(', ')}`, timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  // Check email uniqueness
  const existing = await pool.query('SELECT id FROM merchants WHERE email = $1', [body.email]);
  if (existing.rows.length > 0) {
    return json(res, 409, { success: false, message: 'Email already registered', timestamp: now() });
  }

  // Generate API keys
  const rawSecretKey = generateApiKey('sk', 'live');
  const publicKey = derivePublicKey(rawSecretKey);
  const secretHash = await hashKey(rawSecretKey);
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  // Insert merchant
  const result = await pool.query(
    `INSERT INTO merchants (id, name, email, phone_number, paybill_number, consumer_key, consumer_secret, passkey, shortcode, api_key_public, api_key_secret_hash, webhook_secret, callback_url, created_at, updated_at)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW(), NOW())
     RETURNING id, name, email, api_key_public, shortcode, callback_url, created_at`,
    [body.name, body.email, body.phone_number, body.paybill_number, body.consumer_key, body.consumer_secret, body.passkey, body.shortcode, publicKey, secretHash, webhookSecret, body.callback_url]
  );

  const merchant = result.rows[0];

  console.log(`[Gateway] ✅ Merchant registered: ${merchant.name} (${merchant.id})`);

  json(res, 201, {
    success: true,
    message: 'Merchant registered. Save your secret key — it cannot be retrieved again.',
    data: {
      merchant_id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      api_key_public: publicKey,
      api_key_secret: rawSecretKey,
      webhook_secret: webhookSecret,
      shortcode: merchant.shortcode,
      callback_url: merchant.callback_url,
    },
    timestamp: now(),
  });
}

// Authenticate merchant from Bearer token
async function authenticateMerchant(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;

  const sk = auth.slice(7).trim();
  if (sk.length < 20) return null;

  const pk = derivePublicKey(sk);
  const pool = getDb();
  if (!pool) return null;

  const result = await pool.query(
    'SELECT * FROM merchants WHERE api_key_public = $1 AND is_active = true',
    [pk]
  );

  if (result.rows.length === 0) return null;

  const merchant = result.rows[0];
  const valid = await verifyKey(sk, merchant.api_key_secret_hash);
  if (!valid) return null;

  return merchant;
}

// POST /v1/charges — Initiate STK Push
async function handleCharge(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) {
    return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });
  }

  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON body', timestamp: now() });

  // Validate
  if (!body.amount || body.amount <= 0) {
    return json(res, 400, { success: false, message: 'amount must be a positive number', timestamp: now() });
  }
  if (body.amount > 150000) {
    return json(res, 400, { success: false, message: 'Amount cannot exceed KES 150,000', timestamp: now() });
  }
  if (!body.phone_number) {
    return json(res, 400, { success: false, message: 'phone_number is required', timestamp: now() });
  }
  if (!isValidKenyanPhone(body.phone_number)) {
    return json(res, 400, { success: false, message: 'Invalid Kenyan phone number', timestamp: now() });
  }

  const formattedPhone = formatPhone(body.phone_number);
  const amount = Math.round(body.amount);
  const accountRef = (body.account_reference || `TXN-${Date.now()}`).slice(0, 12);
  const txDesc = (body.transaction_desc || 'M-Pesa Payment').slice(0, 13);

  console.log(`[Gateway] STK Push → merchant=${merchant.name} phone=${maskPhone(formattedPhone)} amount=${amount}`);

  // Get OAuth token
  let accessToken;
  try {
    accessToken = await getAccessToken(merchant.consumer_key, merchant.consumer_secret);
  } catch (e) {
    console.error(`[Gateway] OAuth failed: ${e.message}`);
    return json(res, 502, { success: false, message: 'Payment provider auth failed', error: e.message, timestamp: now() });
  }

  // Build STK Push
  const timestamp = generateTimestamp();
  const password = generatePassword(merchant.shortcode, merchant.passkey, timestamp);

  const stkPayload = {
    BusinessShortCode: merchant.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: formattedPhone,
    PartyB: merchant.shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: merchant.callback_url,
    AccountReference: accountRef,
    TransactionDesc: txDesc,
  };

  // Fire STK Push
  let stkResponse;
  try {
    const res = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(stkPayload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Daraja HTTP ${res.status}: ${text}`);
    }

    stkResponse = await res.json();
  } catch (e) {
    console.error(`[Gateway] STK Push failed: ${e.message}`);
    return json(res, 502, { success: false, message: 'STK Push request failed', error: e.message, timestamp: now() });
  }

  // Log transaction
  const pool = getDb();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO transactions (id, merchant_id, checkout_request_id, merchant_request_id, amount, phone_number, account_reference, status, stk_response_code, stk_response_description)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [merchant.id, stkResponse.CheckoutRequestID, stkResponse.MerchantRequestID, amount, formattedPhone, accountRef, stkResponse.ResponseCode === '0' ? 'STK_SENT' : 'FAILED', stkResponse.ResponseCode, stkResponse.ResponseDescription]
      );
    } catch (e) {
      console.error(`[Gateway] Failed to log transaction: ${e.message}`);
    }
  }

  if (stkResponse.ResponseCode !== '0') {
    console.warn(`[Gateway] ❌ Daraja rejected: ${stkResponse.ResponseCode} — ${stkResponse.ResponseDescription}`);
    return json(res, 400, {
      success: false,
      message: stkResponse.ResponseDescription || 'STK Push rejected',
      error: `Code: ${stkResponse.ResponseCode}`,
      timestamp: now(),
    });
  }

  console.log(`[Gateway] ✅ STK sent — CheckoutRequestID=${stkResponse.CheckoutRequestID}`);

  json(res, 200, {
    success: true,
    message: stkResponse.CustomerMessage || 'STK Push sent',
    data: {
      checkout_request_id: stkResponse.CheckoutRequestID,
      merchant_request_id: stkResponse.MerchantRequestID,
      response_code: stkResponse.ResponseCode,
      response_description: stkResponse.ResponseDescription,
      customer_message: stkResponse.CustomerMessage,
    },
    timestamp: now(),
  });
}

// GET /v1/charges/:id — Check charge status
async function handleChargeStatus(req, res, checkoutRequestId) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const result = await pool.query(
    'SELECT * FROM transactions WHERE checkout_request_id = $1 AND merchant_id = $2',
    [checkoutRequestId, merchant.id]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { success: false, message: 'Transaction not found', timestamp: now() });
  }

  const tx = result.rows[0];
  json(res, 200, {
    success: true,
    message: 'Transaction found',
    data: {
      checkout_request_id: tx.checkout_request_id,
      amount: Number(tx.amount),
      status: tx.status,
      mpesa_receipt_number: tx.mpesa_receipt_number,
      result_code: tx.result_code,
      created_at: tx.created_at,
    },
    timestamp: now(),
  });
}

// POST /v1/mpesa-callback — Daraja async callback (NO auth — Safaricom calls this)
async function handleDarajaCallback(req, res) {
  console.log('[Gateway] Received Daraja callback');

  const body = await readBody(req);
  const stkCallback = body?.Body?.stkCallback;

  if (!stkCallback) {
    console.warn('[Gateway] Invalid callback — missing stkCallback');
    return json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
  }

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;
  console.log(`[Gateway] Callback: CheckoutRequestID=${CheckoutRequestID} ResultCode=${ResultCode}`);

  const pool = getDb();
  if (!pool) return json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });

  // Find transaction by CheckoutRequestID (not phone — Safaricom masks it)
  const txResult = await pool.query(
    'SELECT t.*, m.callback_url, m.webhook_secret, m.name as merchant_name FROM transactions t JOIN merchants m ON t.merchant_id = m.id WHERE t.checkout_request_id = $1',
    [CheckoutRequestID]
  );

  if (txResult.rows.length === 0) {
    console.warn(`[Gateway] No transaction for ${CheckoutRequestID}`);
    return json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
  }

  const tx = txResult.rows[0];

  // Determine status
  let status = 'FAILED';
  if (ResultCode === 0) status = 'SUCCESSFUL';
  else if (ResultCode === 1032) status = 'CANCELLED';
  else if (ResultCode === 1037) status = 'TIMEOUT';

  // Extract receipt number
  let receiptNumber = null;
  if (CallbackMetadata?.Item) {
    for (const item of CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber') receiptNumber = String(item.Value);
    }
  }

  // Update transaction
  await pool.query(
    `UPDATE transactions SET status = $1, result_code = $2, result_description = $3, mpesa_receipt_number = $4 WHERE checkout_request_id = $5`,
    [status, ResultCode, ResultDesc, receiptNumber, CheckoutRequestID]
  );

  console.log(`[Gateway] ✅ Transaction ${tx.id} → ${status} receipt=${receiptNumber || 'N/A'}`);

  // Deliver webhook to merchant (fire-and-forget)
  if (tx.callback_url) {
    deliverWebhook(tx).catch((e) => console.error(`[Gateway] Webhook delivery failed: ${e.message}`));
  }

  // Always return 200 to Safaricom
  json(res, 200, { ResultCode: 0, ResultDesc: 'The service request is processed successfully' });
}

// Deliver webhook to merchant
async function deliverWebhook(tx) {
  const payload = {
    event: tx.status === 'SUCCESSFUL' ? 'payment.successful' : tx.status === 'CANCELLED' ? 'payment.cancelled' : 'payment.failed',
    transaction_id: tx.id,
    merchant_id: tx.merchant_id,
    checkout_request_id: tx.checkout_request_id,
    amount: Number(tx.amount),
    phone_number: tx.phone_number,
    mpesa_receipt_number: tx.mpesa_receipt_number,
    status: tx.status,
    timestamp: now(),
  };

  const signature = signPayload(payload, tx.webhook_secret);

  // Update attempt count
  const pool = getDb();
  if (pool) {
    await pool.query('UPDATE transactions SET webhook_delivered = true, webhook_attempts = webhook_attempts + 1 WHERE id = $1', [tx.id]);
  }

  const res = await fetch(tx.callback_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mpesa-Signature': signature,
      'X-Mpesa-Event': payload.event,
      'User-Agent': 'MpesaExpressGateway/1.0',
    },
    body: JSON.stringify({ ...payload, signature }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  console.log(`[Gateway] ✅ Webhook delivered to ${tx.merchant_name} (${tx.callback_url})`);
}

// GET /v1/merchants/me — Get merchant profile
async function handleMerchantProfile(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  json(res, 200, {
    success: true,
    message: 'Merchant profile',
    data: {
      merchant_id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      phone_number: merchant.phone_number,
      shortcode: merchant.shortcode,
      api_key_public: merchant.api_key_public,
      callback_url: merchant.callback_url,
      is_active: merchant.is_active,
      created_at: merchant.created_at,
    },
    timestamp: now(),
  });
}

// GET /v1/merchants/stats — Transaction statistics
async function handleMerchantStats(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const stats = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'SUCCESSFUL') as successful,
       COUNT(*) FILTER (WHERE status = 'PENDING' OR status = 'STK_SENT') as pending,
       COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
       COALESCE(SUM(amount) FILTER (WHERE status = 'SUCCESSFUL'), 0) as total_revenue
     FROM transactions WHERE merchant_id = $1`,
    [merchant.id]
  );

  const s = stats.rows[0];
  json(res, 200, {
    success: true,
    message: 'Transaction statistics',
    data: {
      total_transactions: Number(s.total),
      successful: Number(s.successful),
      pending: Number(s.pending),
      failed: Number(s.failed),
      total_revenue: Number(s.total_revenue),
      success_rate: Number(s.total) > 0 ? ((Number(s.successful) / Number(s.total)) * 100).toFixed(1) + '%' : '0%',
    },
    timestamp: now(),
  });
}

// POST /v1/merchants/keys/rotate — Rotate API keys
async function handleRotateKeys(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const rawSecretKey = generateApiKey('sk', 'live');
  const publicKey = derivePublicKey(rawSecretKey);
  const secretHash = await hashKey(rawSecretKey);

  await pool.query('UPDATE merchants SET api_key_public = $1, api_key_secret_hash = $2 WHERE id = $3', [publicKey, secretHash, merchant.id]);

  // Log rotation
  await pool.query(
    'INSERT INTO api_key_logs (id, merchant_id, action, ip_address, user_agent) VALUES (gen_random_uuid(), $1,$2,$3,$4)',
    [merchant.id, 'rotated', req.socket.remoteAddress, req.headers['user-agent'] || null]
  );

  console.log(`[Gateway] 🔑 Keys rotated for ${merchant.name}`);

  json(res, 200, {
    success: true,
    message: 'API keys rotated. Old keys invalidated.',
    data: { api_key_public: publicKey, api_key_secret: rawSecretKey },
    timestamp: now(),
  });
}

// ─── Test Callback (dev only) ───────────────────────────────────────
async function handleTestCallback(req, res) {
  if (process.env.NODE_ENV === 'production') return json(res, 404, { error: 'Not found' });

  const body = await readBody(req);
  if (!body?.checkout_request_id) {
    return json(res, 400, { error: 'checkout_request_id required' });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { error: 'No database' });

  const txResult = await pool.query(
    'SELECT t.*, m.callback_url, m.webhook_secret, m.name as merchant_name FROM transactions t JOIN merchants m ON t.merchant_id = m.id WHERE t.checkout_request_id = $1',
    [body.checkout_request_id]
  );

  if (txResult.rows.length === 0) {
    return json(res, 404, { error: 'Transaction not found' });
  }

  const tx = txResult.rows[0];
  const resultCode = body.result_code || 0;

  await pool.query(
    `UPDATE transactions SET status = $1, result_code = $2, result_description = $3, mpesa_receipt_number = $4 WHERE checkout_request_id = $5`,
    [resultCode === 0 ? 'SUCCESSFUL' : 'CANCELLED', resultCode, resultCode === 0 ? 'Test success' : 'Test cancel', `TEST${Date.now().toString(36).toUpperCase()}`, body.checkout_request_id]
  );

  if (tx.callback_url) {
    deliverWebhook({ ...tx, status: resultCode === 0 ? 'SUCCESSFUL' : 'CANCELLED', mpesa_receipt_number: `TEST${Date.now().toString(36).toUpperCase()}` }).catch(() => {});
  }

  json(res, 200, { success: true, message: 'Test callback processed', checkout_request_id: body.checkout_request_id });
}

// ═══════════════════════════════════════════════════════════════════════
// Main Router — always listening on /v1/*
// ═══════════════════════════════════════════════════════════════════════

module.exports = async function gatewayHandler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;
  const method = req.method;

  try {
    // Health (no auth)
    if (path === '/v1/health' && method === 'GET') {
      return handleHealth(req, res);
    }

    // Daraja callback (no auth — Safaricom calls this)
    if (path === '/v1/mpesa-callback' && method === 'POST') {
      return handleDarajaCallback(req, res);
    }

    // Test callback (dev only)
    if (path === '/v1/test-callback' && method === 'POST') {
      return handleTestCallback(req, res);
    }

    // Merchant registration (no auth) — must come before the generic /v1/merchants catch-all
    if (path === '/v1/merchants' && method === 'POST') {
      return handleRegister(req, res);
    }

    // Authenticated routes (require Bearer token)
    if (path === '/v1/charges' && method === 'POST') {
      return handleCharge(req, res);
    }

    // GET /v1/charges/:checkout_request_id
    const chargeMatch = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (chargeMatch && method === 'GET') {
      return handleChargeStatus(req, res, chargeMatch[1]);
    }

    if (path === '/v1/merchants/me' && method === 'GET') {
      return handleMerchantProfile(req, res);
    }

    if (path === '/v1/merchants/stats' && method === 'GET') {
      return handleMerchantStats(req, res);
    }

    if (path === '/v1/merchants/keys/rotate' && method === 'POST') {
      return handleRotateKeys(req, res);
    }

    // 404
    json(res, 404, { success: false, message: 'Endpoint not found', timestamp: now() });
  } catch (error) {
    console.error('[Gateway] Error:', error);
    json(res, 500, { success: false, message: 'Internal server error', timestamp: now() });
  }
};

module.exports.handleDarajaCallback = handleDarajaCallback;
