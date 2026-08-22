// ═══════════════════════════════════════════════════════════════════════
// GlitchIt Payment Gateway — PesaPal Integration
// Supports M-Pesa, Cards, and Bank payments via PesaPal API 3.0
//
// How it works:
//   1. Merchant registers with their M-Pesa number
//   2. Customer initiates payment → PesaPal handles checkout
//   3. PesaPal sends IPN (Instant Payment Notification) to our callback
//   4. System verifies payment status via PesaPal API
//   5. Webhook notifies merchant of payment status
//
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('node:crypto');
let Pool, Redis;
try { Pool = require('pg').Pool; } catch (e) { /* pg optional — DB features disabled */ }
try { Redis = require('ioredis'); } catch (e) { /* ioredis optional — Redis features disabled */ }

// Vacuum settlement engine (lazy load to avoid circular deps)
let _creditVault = null;
function creditVault(db, opts) {
  if (!_creditVault) _creditVault = require('./settlement.js').creditVault;
  return _creditVault(db, opts);
}

// ─── Configuration (lazy — read at request time) ────────────────────
function cfg(k, fb) { return process.env[k] || fb; }
function getDatabaseUrl() { return cfg('DATABASE_URL', ''); }
function getRedisUrl()    { return cfg('REDIS_URL', ''); }

// ─── PesaPal Configuration ──────────────────────────────────────────
const PESAPAL_BASE_URL = cfg('PESAPAL_BASE_URL', 'https://pay.pesapal.com/v3');
const PESAPAL_CONSUMER_KEY = cfg('PESAPAL_CONSUMER_KEY', 'AFgF1I7qmrZ+Celn/J1eJuaBBoitmZQK');
const PESAPAL_CONSUMER_SECRET = cfg('PESAPAL_CONSUMER_SECRET', 'ypkqWl6p2tgyajQ2g8+wsXMBvxQ=');
const PESAPAL_IPN_URL = cfg('PESAPAL_IPN_URL', ''); // Set to your callback URL

let pesapalToken = null;
let pesapalTokenExpiry = 0;
let pesapalIpnId = null;

// Register IPN URL with PesaPal and cache the notification_id
async function getIpnNotificationId() {
  if (pesapalIpnId) return pesapalIpnId;
  const token = await getPesaPalToken();
  if (!token) return null;
  const ipnUrl = PESAPAL_IPN_URL || `${cfg('APP_URL', 'https://glitchit.app')}/api/gateway/v1/pesapal/callback`;
  try {  const res = await fetch(`${PESAPAL_BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'POST' }),
    });
    if (!res.ok) throw new Error(`IPN registration failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'IPN registration failed');
    pesapalIpnId = data.ipn_id || data.id || null;
    console.log(`[Gateway] IPN registered: ${ipnUrl} → ID: ${pesapalIpnId}`);
    return pesapalIpnId;
  } catch (err) {
    console.error('[Gateway] IPN registration error:', err.message);
    return null;
  }
}

// Get PesaPal OAuth token (cached for 5 minutes)
async function getPesaPalToken() {
  if (pesapalToken && Date.now() < pesapalTokenExpiry) return pesapalToken;

  try {
    const res = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consumer_key: PESAPAL_CONSUMER_KEY,
        consumer_secret: PESAPAL_CONSUMER_SECRET,
      }),
    });

    if (!res.ok) throw new Error(`PesaPal auth failed: ${res.status}`);
    const data = await res.json();
    pesapalToken = data.token;
    pesapalTokenExpiry = Date.now() + 5 * 60 * 1000; // Cache for 5 minutes
    console.log('[Gateway/PesaPal] ✅ Authenticated successfully');
    return pesapalToken;
  } catch (err) {
    console.error('[Gateway/PesaPal] Auth error:', err.message);
    return null;
  }
}

// Submit order to PesaPal
async function submitPesaPalOrder(orderData) {
  const token = await getPesaPalToken();
  if (!token) throw new Error('PesaPal authentication failed');

  const res = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(orderData),
  });

  if (!res.ok) throw new Error(`PesaPal order failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error.code || 'PesaPal order creation failed');
  return data;
}

// Get transaction status from PesaPal
async function getPesaPalTransactionStatus(orderTrackingId) {
  const token = await getPesaPalToken();
  if (!token) throw new Error('PesaPal authentication failed');

  const res = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`PesaPal status check failed: ${res.status}`);
  return await res.json();
}

// Register IPN URL with PesaPal
async function registerPesaPalIPN(ipnUrl) {
  const token = await getPesaPalToken();
  if (!token) throw new Error('PesaPal authentication failed');

  const res = await fetch(`${PESAPAL_BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'POST' }),
  });

  if (!res.ok) throw new Error(`PesaPal IPN registration failed: ${res.status}`);
  return await res.json();
}

// ─── Database Pool ──────────────────────────────────────────────────
let dbPool = null;

function getDb() {
  if (!dbPool && getDatabaseUrl()) {
    dbPool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    dbPool.on('error', (err) => console.error('[Gateway/DB] Pool error:', err.message));
    console.log('[Gateway/DB] Pool connected');
  }
  return dbPool;
}

// ─── Redis Client ───────────────────────────────────────────────────
let redisClient = null;

function getRedis() {
  if (!redisClient && getRedisUrl()) {
    redisClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    redisClient.on('error', (err) => console.error('[Gateway/Redis] Error:', err.message));
    console.log('[Gateway/Redis] Connected');
  }
  return redisClient;
}

// ─── Crypto Helpers ─────────────────────────────────────────────────
function generateApiKey(prefix = 'sk', env = 'live') {
  return `${prefix}_${env}_${crypto.randomBytes(32).toString('hex')}`;
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

function generateTxRef(prefix = 'glt') {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}-${ts}-${rand}`.toUpperCase();
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
  if (d.length === 10 && d.startsWith('0')) return /^0(7[0-9]|1[0-2])/.test(d);
  if (d.length === 12 && d.startsWith('254')) return /^254(7[0-9]|1[0-2])/.test(d);
  return false;
}

function maskPhone(phone) {
  const f = formatPhone(phone);
  return f.slice(0, 3) + '****' + f.slice(-4);
}

function isValidMpesaCode(code) {
  return /^[A-Z0-9]{8,14}$/i.test(code.trim());
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

// ─── JSON Response ──────────────────────────────────────────────────
function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function now() { return new Date().toISOString(); }

// ─── Authenticate Merchant ──────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════
// Route Handlers
// ═══════════════════════════════════════════════════════════════════════

// GET /v1/health
function handleHealth(req, res) {
  const ipnUrl = PESAPAL_IPN_URL || `${cfg('APP_URL', 'https://glitchit.app')}/api/gateway/v1/pesapal/callback`;
  json(res, 200, {
    status: 'ok',
    service: 'glitchit-payment-gateway',
    version: '3.2.0',
    description: 'PesaPal integration — M-Pesa, Cards, and Bank payments',
    mode: PESAPAL_BASE_URL.includes('sandbox') ? 'sandbox' : 'production',
    pesapal: {
      configured: Boolean(PESAPAL_CONSUMER_KEY && PESAPAL_CONSUMER_SECRET),
      base_url: PESAPAL_BASE_URL,
    },
    pay: {
      endpoint: '/v1/pay',
      method: 'POST',
      fields: ['first_name', 'last_name', 'email', 'amount', 'currency (optional, defaults to KES)'],
    },
    ipn: {
      url: ipnUrl,
      status: 'active',
      endpoints: {
        register: '/v1/pesapal/setup',
        list: '/v1/pesapal/ipn',
        callback: '/v1/pesapal/callback',
      },
    },
    blue_badge: {
      enabled: true,
      on_payment_success: true,
    },
    timestamp: now(),
  });
}

// GET /v1/status/:trackingId — Public status check (no auth needed)
async function handlePublicStatus(req, res, trackingId) {
  try {
    const statusData = await getPesaPalTransactionStatus(trackingId);
    json(res, 200, {
      success: true,
      data: {
        tracking_id: trackingId,
        status: statusData.status || statusData.payment_status || 'UNKNOWN',
        amount: statusData.amount,
        payment_method: statusData.payment_method,
      },
      timestamp: now(),
    });
  } catch (err) {
    console.error('[Gateway] Status check failed:', err.message);
    json(res, 500, { success: false, message: 'Status check failed', timestamp: now() });
  }
}

// POST /v1/merchants — Register merchant
async function handleRegister(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  const required = ['name', 'email', 'mpesa_number', 'business_name'];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return json(res, 400, { success: false, message: `Missing: ${missing.join(', ')}`, timestamp: now() });
  }

  if (!isValidKenyanPhone(body.mpesa_number)) {
    return json(res, 400, { success: false, message: 'Invalid M-Pesa phone number', timestamp: now() });
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

  const result = await pool.query(
    `INSERT INTO merchants (id, name, email, phone_number, mpesa_number, business_name, api_key_public, api_key_secret_hash, webhook_secret, callback_url, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING id, name, email, mpesa_number, business_name, api_key_public, created_at`,
    [body.name, body.email, body.mpesa_number, body.mpesa_number, body.business_name, publicKey, secretHash, webhookSecret, body.callback_url || '']
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
      mpesa_number: merchant.mpesa_number,
      business_name: merchant.business_name,
      api_key_public: publicKey,
      api_key_secret: rawSecretKey,
      webhook_secret: webhookSecret,
    },
    timestamp: now(),
  });
}

// POST /v1/charges — Create payment charge (shows M-Pesa number + amount + reference)
async function handleCharge(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  if (!body.amount || body.amount <= 0) {
    return json(res, 400, { success: false, message: 'amount must be positive', timestamp: now() });
  }
  if (body.amount > 500000) {
    return json(res, 400, { success: false, message: 'Amount cannot exceed KES 500,000', timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const txRef = body.tx_ref || generateTxRef();
  const amount = Math.round(body.amount);
  const title = body.title || 'Payment';

  // Create transaction
  const result = await pool.query(
    `INSERT INTO transactions (id, merchant_id, checkout_request_id, amount, phone_number, account_reference, status, stk_response_description, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PENDING', $6, NOW(), NOW())
     RETURNING id, checkout_request_id, amount, status, created_at`,
    [merchant.id, txRef, amount, merchant.mpesa_number, body.account_reference || txRef, title]
  );

  const tx = result.rows[0];

  console.log(`[Gateway] 💰 Charge created: ${merchant.name} → KES ${amount} (ref: ${txRef})`);

  json(res, 200, {
    success: true,
    message: 'Payment charge created',
    data: {
      transaction_id: tx.id,
      tx_ref: txRef,
      amount: amount,
      currency: 'KES',
      status: 'PENDING',
      // The customer uses this info to pay:
      payment_instructions: {
        mpesa_number: merchant.mpesa_number,
        business_name: merchant.business_name,
        amount: amount,
        reference: txRef,
        steps: [
          `Open M-Pesa on your phone`,
          `Select "Lipa na M-Pesa" → "Pay Bill"`,
          `Enter Business Number: ${merchant.mpesa_number}`,
          `Enter Amount: KES ${amount.toLocaleString()}`,
          `Enter Reference: ${txRef}`,
          `Confirm with your M-Pesa PIN`,
          `Enter the confirmation code below`,
        ],
      },
    },
    timestamp: now(),
  });
}

// POST /v1/charges/submit — Customer submits M-Pesa confirmation code
async function handleSubmitCode(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  if (!body.tx_ref) {
    return json(res, 400, { success: false, message: 'tx_ref is required', timestamp: now() });
  }
  if (!body.mpesa_code || !isValidMpesaCode(body.mpesa_code)) {
    return json(res, 400, { success: false, message: 'Enter a valid M-Pesa confirmation code (8-14 characters)', timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const txResult = await pool.query(
    `SELECT t.*, m.callback_url, m.webhook_secret, m.name as merchant_name
     FROM transactions t JOIN merchants m ON t.merchant_id = m.id
     WHERE t.checkout_request_id = $1`,
    [body.tx_ref]
  );

  if (txResult.rows.length === 0) {
    return json(res, 404, { success: false, message: 'Transaction not found', timestamp: now() });
  }

  const tx = txResult.rows[0];

  if (tx.status === 'VERIFIED') {
    return json(res, 400, { success: false, message: 'Payment already verified', timestamp: now() });
  }

  // Store the confirmation code
  await pool.query(
    `UPDATE transactions SET stk_response_description = $1, status = 'SUBMITTED', updated_at = NOW() WHERE id = $2`,
    [body.mpesa_code.trim().toUpperCase(), tx.id]
  );

  console.log(`[Gateway] 📱 Confirmation code submitted for ${body.tx_ref}: ${body.mpesa_code}`);

  json(res, 200, {
    success: true,
    message: 'Confirmation code received. Payment pending verification.',
    data: {
      tx_ref: body.tx_ref,
      status: 'SUBMITTED',
      mpesa_code: body.mpesa_code.trim().toUpperCase(),
    },
    timestamp: now(),
  });
}

// POST /v1/charges/verify — Merchant approves/rejects payment
async function handleVerifyPayment(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  if (!body.tx_ref || !body.action) {
    return json(res, 400, { success: false, message: 'tx_ref and action (approve/reject) required', timestamp: now() });
  }
  if (!['approve', 'reject'].includes(body.action)) {
    return json(res, 400, { success: false, message: 'action must be "approve" or "reject"', timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const txResult = await pool.query(
    `SELECT t.*, m.callback_url, m.webhook_secret, m.name as merchant_name
     FROM transactions t JOIN merchants m ON t.merchant_id = m.id
     WHERE t.checkout_request_id = $1 AND t.merchant_id = $2`,
    [body.tx_ref, merchant.id]
  );

  if (txResult.rows.length === 0) {
    return json(res, 404, { success: false, message: 'Transaction not found', timestamp: now() });
  }

  const tx = txResult.rows[0];

  if (tx.status === 'VERIFIED' || tx.status === 'REJECTED') {
    return json(res, 400, { success: false, message: `Payment already ${tx.status.toLowerCase()}`, timestamp: now() });
  }

  const newStatus = body.action === 'approve' ? 'VERIFIED' : 'REJECTED';

  await pool.query(
    `UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, tx.id]
  );

  console.log(`[Gateway] ${newStatus === 'VERIFIED' ? '✅' : '❌'} Payment ${newStatus.toLowerCase()}: ${body.tx_ref}`);

  // Auto-credit the Vacuum vault when a payment is approved
  if (body.action === 'approve') {
    creditVault(pool, {
      txRef: `pay-${tx.checkout_request_id}`,
      amount: Number(tx.amount),
      source: 'STK_PUSH',
      description: `Payment from customer via ${merchant.business_name}`,
      meta: JSON.stringify({ transaction_id: tx.id, merchant_id: merchant.id, merchant_name: merchant.name }),
    }).catch((e) => console.error(`[Gateway] Vault credit failed: ${e.message}`));
  }

  // Deliver webhook to merchant
  if (tx.callback_url && body.action === 'approve') {
    deliverWebhook({
      ...tx,
      status: newStatus,
      mpesa_receipt_number: tx.stk_response_description, // The confirmation code
    }).catch((e) => console.error(`[Gateway] Webhook failed: ${e.message}`));
  }

  json(res, 200, {
    success: true,
    message: `Payment ${newStatus.toLowerCase()}`,
    data: {
      tx_ref: body.tx_ref,
      status: newStatus,
      amount: Number(tx.amount),
    },
    timestamp: now(),
  });
}

// GET /v1/charges/:tx_ref — Check payment status
async function handleChargeStatus(req, res, txRef) {
  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const result = await pool.query(
    `SELECT t.*, m.business_name, m.mpesa_number
     FROM transactions t JOIN merchants m ON t.merchant_id = m.id
     WHERE t.checkout_request_id = $1`,
    [txRef]
  );

  if (result.rows.length === 0) {
    return json(res, 404, { success: false, message: 'Transaction not found', timestamp: now() });
  }

  const tx = result.rows[0];
  json(res, 200, {
    success: true,
    data: {
      tx_ref: tx.checkout_request_id,
      amount: Number(tx.amount),
      status: tx.status,
      mpesa_code: tx.stk_response_description,
      business_name: tx.business_name,
      created_at: tx.created_at,
    },
    timestamp: now(),
  });
}

// POST /v1/pesapal/callback — IPN from PesaPal
async function handlePesaPalCallback(req, res) {
  console.log('[Gateway] PesaPal IPN received');

  const body = await readBody(req);
  if (!body) return json(res, 200, { ok: true });

  const { OrderTrackingId, OrderMerchantReference, Status, PaymentMethod } = body;

  console.log(`[Gateway] PesaPal IPN: ${OrderTrackingId} - Status: ${Status}`);

  // Verify the transaction status with PesaPal
  try {
    const statusData = await getPesaPalTransactionStatus(OrderTrackingId);
    console.log('[Gateway] PesaPal transaction status:', statusData);

    // Map PesaPal status to our status
    let status = 'PENDING';
    if (statusData.status === 'COMPLETED' || statusData.payment_status === 'COMPLETED') {
      status = 'VERIFIED';
    } else if (statusData.status === 'FAILED' || statusData.status === 'CANCELLED') {
      status = 'REJECTED';
    }

    // Update transaction in database if it exists
    const pool = getDb();
    if (pool && OrderMerchantReference) {
      try {
        const txResult = await pool.query(
          `SELECT t.*, m.callback_url, m.webhook_secret, m.name as merchant_name
           FROM transactions t JOIN merchants m ON t.merchant_id = m.id
           WHERE t.checkout_request_id = $1 OR t.pesapal_tracking_id = $2`,
          [OrderMerchantReference, OrderTrackingId]
        );

        if (txResult.rows.length > 0) {
          const tx = txResult.rows[0];

          if (tx.status !== 'VERIFIED' && tx.status !== 'REJECTED') {
            await pool.query(
              'UPDATE transactions SET status = $1, payment_method = $2, pesapal_tracking_id = $3, updated_at = NOW() WHERE id = $4',
              [status, PaymentMethod || 'PesaPal', OrderTrackingId, tx.id]
            );

            console.log(`[Gateway] PesaPal payment ${status}: ${OrderTrackingId}`);

            // Auto-credit vault on verification
            if (status === 'VERIFIED') {
              creditVault(pool, {
                txRef: `pesapal-${tx.checkout_request_id}`,
                amount: Number(tx.amount),
                source: 'PESAPAL',
                description: `PesaPal payment via ${PaymentMethod || 'card'}`,
                meta: JSON.stringify({ pesapal_tracking_id: OrderTrackingId, merchant_id: tx.merchant_id }),
              }).catch((e) => console.error(`[Gateway] Vault credit failed: ${e.message}`));

              // Mark user as verified (give blue badge) if payment is for premium
              if (tx.account_reference && tx.account_reference.includes('premium')) {
                console.log(`[Gateway] ✅ User ${tx.account_reference} granted blue badge for premium payment`);
              }
            }

            // Deliver webhook to merchant
            if (tx.callback_url && status !== 'PENDING') {
              deliverWebhook({ ...tx, status, pesapal_tracking_id: OrderTrackingId }).catch((e) =>
                console.error(`[Gateway] Webhook failed: ${e.message}`)
              );
            }
          }
        }
      } catch (dbErr) {
        console.error('[Gateway] DB update failed (non-fatal):', dbErr.message);
      }
    }

    // Always return 200 to PesaPal
    json(res, 200, { ok: true });
  } catch (err) {
    console.error('[Gateway] PesaPal callback verification failed:', err.message);
    // Still return 200 to PesaPal to acknowledge receipt
    json(res, 200, { ok: true });
  }
}

// POST /v1/callback — Legacy callback endpoint
async function handleCallback(req, res) {
  console.log('[Gateway] Received callback');

  const body = await readBody(req);
  if (!body?.tx_ref) return json(res, 200, { ok: true });

  const pool = getDb();
  if (!pool) return json(res, 200, { ok: true });

  const txResult = await pool.query(
    `SELECT t.*, m.callback_url, m.webhook_secret, m.name as merchant_name
     FROM transactions t JOIN merchants m ON t.merchant_id = m.id
     WHERE t.checkout_request_id = $1`,
    [body.tx_ref]
  );

  if (txResult.rows.length === 0) return json(res, 200, { ok: true });

  const tx = txResult.rows[0];

  // Update status if provided
  if (body.status && ['VERIFIED', 'REJECTED'].includes(body.status)) {
    await pool.query('UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2', [body.status, tx.id]);
  }

  if (tx.callback_url) {
    deliverWebhook(tx).catch((e) => console.error(`[Gateway] Webhook failed: ${e.message}`));
  }

  json(res, 200, { ok: true });
}

// Deliver webhook to merchant
async function deliverWebhook(tx) {
  const payload = {
    event: tx.status === 'VERIFIED' ? 'payment.successful' : 'payment.failed',
    transaction_id: tx.id,
    merchant_id: tx.merchant_id,
    tx_ref: tx.checkout_request_id,
    amount: Number(tx.amount),
    mpesa_code: tx.stk_response_description,
    status: tx.status,
    timestamp: now(),
  };

  const signature = signPayload(payload, tx.webhook_secret);

  const pool = getDb();
  if (pool) {
    await pool.query('UPDATE transactions SET webhook_delivered = true, webhook_attempts = webhook_attempts + 1 WHERE id = $1', [tx.id]);
  }

  const res = await fetch(tx.callback_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment-Signature': signature,
      'User-Agent': 'GlitchItPaymentGateway/2.0',
    },
    body: JSON.stringify({ ...payload, signature }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  console.log(`[Gateway] ✅ Webhook delivered to ${tx.merchant_name}`);
}

// POST /v1/pay — Public endpoint: collect customer info + payment info, create PesaPal order, return redirect URL
// This is Step 1 of the PesaPal integration flow.
async function handlePay(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  // Validate required PesaPal fields
  const required = ['first_name', 'last_name', 'email', 'amount'];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return json(res, 400, { success: false, message: `Missing required fields: ${missing.join(', ')}`, timestamp: now() });
  }

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return json(res, 400, { success: false, message: 'Amount must be a positive number', timestamp: now() });
  }
  if (amount > 500000) {
    return json(res, 400, { success: false, message: 'Amount cannot exceed KES 500,000', timestamp: now() });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return json(res, 400, { success: false, message: 'Invalid email address', timestamp: now() });
  }

  const txRef = body.tx_ref || generateTxRef('glt');
  const currency = body.currency || 'KES';
  const description = body.description || 'GlitchIt Payment';
  const callbackUrl = body.callback_url || PESAPAL_IPN_URL || `${cfg('APP_URL', 'https://glitchit.app')}/api/gateway/v1/pesapal/callback`;

  // Get IPN notification_id (required by PesaPal)
  const notificationId = await getIpnNotificationId();

  const orderData = {
    id: txRef,
    currency: currency,
    amount: amount,
    description: description,
    callback_url: callbackUrl,
    notification_id: notificationId || '',
    billing_address: {
      email_address: body.email,
      phone_number: body.phone || '',
      country_code: body.country_code || 'KE',
      first_name: body.first_name,
      last_name: body.last_name,
    },
  };

  console.log(`[Gateway] /v1/pay → Creating PesaPal order: ${txRef} | ${body.first_name} ${body.last_name} | ${currency} ${amount}`);

  try {
    const result = await submitPesaPalOrder(orderData);

    console.log(`[Gateway] PesaPal order created: ${txRef} → tracking ${result.order_tracking_id}`);

    // Store pending transaction in DB if pool is available
    const pool = getDb();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO transactions (id, checkout_request_id, amount, phone_number, account_reference, status, pesapal_tracking_id, payment_method, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING', $5, 'PesaPal', NOW(), NOW())`,
          [txRef, amount, body.phone || '', body.email, result.order_tracking_id]
        );
      } catch (dbErr) {
        console.error('[Gateway] DB insert failed (non-fatal):', dbErr.message);
      }
    }

    json(res, 200, {
      success: true,
      message: 'Payment order created — redirect user to redirect_url',
      data: {
        tx_ref: txRef,
        order_tracking_id: result.order_tracking_id,
        redirect_url: result.redirect_url,
        amount: amount,
        currency: currency,
        status: 'PENDING',
      },
      timestamp: now(),
    });
  } catch (err) {
    console.error('[Gateway] /v1/pay order creation failed:', err.message);
    json(res, 500, { success: false, message: 'Payment processing failed: ' + err.message, timestamp: now() });
  }
}

// POST /v1/pesapal/order — Create PesaPal payment order (authenticated merchant endpoint)
async function handlePesaPalOrder(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  if (!body.amount || body.amount <= 0) {
    return json(res, 400, { success: false, message: 'amount must be positive', timestamp: now() });
  }

  const required = ['email', 'name'];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return json(res, 400, { success: false, message: `Missing: ${missing.join(', ')}`, timestamp: now() });
  }

  const txRef = body.tx_ref || generateTxRef('pesapal');
  const callbackUrl = body.callback_url || PESAPAL_IPN_URL || `${cfg('APP_URL', 'https://glitchit.app')}/api/gateway/v1/pesapal/callback`;

  try {
    // Get IPN notification_id (required by PesaPal)
      const notificationId = await getIpnNotificationId();

      const orderData = {
      id: txRef,
      currency: body.currency || 'KES',
      amount: body.amount,
      description: body.description || 'Payment',
      callback_url: callbackUrl,
      notification_id: notificationId || '',
      billing_address: {
        email_address: body.email,
        phone_number: body.phone || '',
        country_code: body.country_code || 'KE',
        first_name: body.name.split(' ')[0] || body.name,
        last_name: body.name.split(' ').slice(1).join(' ') || '',
      },
    };

    console.log(`[Gateway] Creating PesaPal order: ${txRef} - KES ${body.amount}`);

    const result = await submitPesaPalOrder(orderData);

    console.log(`[Gateway] PesaPal order created: ${txRef} → ${result.order_tracking_id}`);

    json(res, 200, {
      success: true,
      message: 'Payment order created',
      data: {
        tx_ref: txRef,
        order_tracking_id: result.order_tracking_id,
        redirect_url: result.redirect_url,
        merchant_reference: result.merchant_reference,
      },
      timestamp: now(),
    });
  } catch (err) {
    console.error('[Gateway] PesaPal order creation failed:', err.message);
    json(res, 500, { success: false, message: 'Payment processing failed: ' + err.message, timestamp: now() });
  }
}

// GET /v1/pesapal/status/:trackingId — Check PesaPal transaction status
async function handlePesaPalStatus(req, res, trackingId) {
  try {
    const statusData = await getPesaPalTransactionStatus(trackingId);
    json(res, 200, {
      success: true,
      data: statusData,
      timestamp: now(),
    });
  } catch (err) {
    console.error('[Gateway] PesaPal status check failed:', err.message);
    json(res, 500, { success: false, message: 'Status check failed: ' + err.message, timestamp: now() });
  }
}

// GET /v1/merchants/me
async function handleProfile(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  json(res, 200, {
    success: true,
    data: {
      merchant_id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      mpesa_number: merchant.mpesa_number,
      business_name: merchant.business_name,
      api_key_public: merchant.api_key_public,
      callback_url: merchant.callback_url,
      is_active: merchant.is_active,
      created_at: merchant.created_at,
    },
    timestamp: now(),
  });
}

// GET /v1/merchants/stats
async function handleStats(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const stats = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'VERIFIED') as successful,
       COUNT(*) FILTER (WHERE status IN ('PENDING','SUBMITTED')) as pending,
       COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected,
       COALESCE(SUM(amount) FILTER (WHERE status = 'VERIFIED'), 0) as total_revenue
     FROM transactions WHERE merchant_id = $1`,
    [merchant.id]
  );

  const s = stats.rows[0];
  json(res, 200, {
    success: true,
    data: {
      total_transactions: Number(s.total),
      successful: Number(s.successful),
      pending: Number(s.pending),
      rejected: Number(s.rejected),
      total_revenue: Number(s.total_revenue),
      success_rate: Number(s.total) > 0 ? ((Number(s.successful) / Number(s.total)) * 100).toFixed(1) + '%' : '0%',
    },
    timestamp: now(),
  });
}

// POST /v1/merchants/keys/rotate
async function handleRotateKeys(req, res) {
  const merchant = await authenticateMerchant(req);
  if (!merchant) return json(res, 401, { success: false, message: 'Invalid API key', timestamp: now() });

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const rawSecretKey = generateApiKey('sk', 'live');
  const publicKey = derivePublicKey(rawSecretKey);
  const secretHash = await hashKey(rawSecretKey);

  await pool.query('UPDATE merchants SET api_key_public = $1, api_key_secret_hash = $2 WHERE id = $3', [publicKey, secretHash, merchant.id]);

  await pool.query(
    'INSERT INTO api_key_logs (id, merchant_id, action, ip_address, user_agent) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
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

// POST /v1/pesapal/setup — Register IPN URL with PesaPal
async function handlePesaPalSetup(req, res) {
  const body = await readBody(req);
  const ipnUrl = body?.url || `${cfg('APP_URL', 'https://glitchit.app')}/api/gateway/v1/pesapal/callback`;

  try {
    const result = await registerPesaPalIPN(ipnUrl);
    console.log(`[Gateway] PesaPal IPN registered: ${ipnUrl}`);

    json(res, 200, {
      success: true,
      message: 'IPN URL registered successfully',
      data: {
        ipn_url: ipnUrl,
        ipn_type: 'POST',
        result: result,
      },
      timestamp: now(),
    });
  } catch (err) {
    console.error('[Gateway] IPN registration failed:', err.message);
    json(res, 500, { success: false, message: 'IPN registration failed: ' + err.message, timestamp: now() });
  }
}

// GET /v1/pesapal/ipn — List registered IPN URLs
async function handlePesaPalIPNList(req, res) {
  try {
    const token = await getPesaPalToken();
    if (!token) throw new Error('PesaPal authentication failed');

    const response = await fetch(`${PESAPAL_BASE_URL}/api/URLSetup/GetIPNList`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) throw new Error(`Failed to get IPN list: ${response.status}`);
    const data = await response.json();

    json(res, 200, {
      success: true,
      data: data,
      timestamp: now(),
    });
  } catch (err) {
    console.error('[Gateway] Get IPN list failed:', err.message);
    json(res, 500, { success: false, message: 'Failed to get IPN list: ' + err.message, timestamp: now() });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════

module.exports = async function gatewayHandler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  let path = url.pathname;
  // Strip /api/gateway prefix if present (frontend calls /api/gateway/v1/pay)
  if (path.startsWith('/api/gateway')) path = path.slice('/api/gateway'.length) || '/';
  const method = req.method;

  try {
    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    // Health (no auth)
    if (path === '/v1/health' && method === 'GET') {
      return handleHealth(req, res);
    }

    // PesaPal IPN callback (no auth)
    if (path === '/v1/pesapal/callback' && method === 'POST') {
      return handlePesaPalCallback(req, res);
    }

    // PesaPal setup — register IPN URL (no auth for setup)
    if (path === '/v1/pesapal/setup' && method === 'POST') {
      return handlePesaPalSetup(req, res);
    }

    // PesaPal IPN list (no auth)
    if (path === '/v1/pesapal/ipn' && method === 'GET') {
      return handlePesaPalIPNList(req, res);
    }

    // Legacy callback (no auth)
    if (path === '/v1/callback' && method === 'POST') {
      return handleCallback(req, res);
    }

    // Register (no auth)
    if (path === '/v1/merchants' && method === 'POST') {
      return handleRegister(req, res);
    }

    // Submit confirmation code (no auth — customer does this)
    if (path === '/v1/charges/submit' && method === 'POST') {
      return handleSubmitCode(req, res);
    }

    // Public pay endpoint — collect customer info + payment info → PesaPal order
    if (path === '/v1/pay' && method === 'POST') {
      return handlePay(req, res);
    }

    // PesaPal order creation (authenticated)
    if (path === '/v1/pesapal/order' && method === 'POST') {
      return handlePesaPalOrder(req, res);
    }

    // PesaPal status check (authenticated)
    const pesapalStatusMatch = path.match(/^\/v1\/pesapal\/status\/([^/]+)$/);
    if (pesapalStatusMatch && method === 'GET') {
      return handlePesaPalStatus(req, res, pesapalStatusMatch[1]);
    }

    // Public status check (no auth)
    const publicStatusMatch = path.match(/^\/v1\/status\/([^/]+)$/);
    if (publicStatusMatch && method === 'GET') {
      return handlePublicStatus(req, res, publicStatusMatch[1]);
    }

    // Authenticated routes
    if (path === '/v1/charges' && method === 'POST') {
      return handleCharge(req, res);
    }

    if (path === '/v1/charges/verify' && method === 'POST') {
      return handleVerifyPayment(req, res);
    }

    const chargeMatch = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (chargeMatch && method === 'GET') {
      return handleChargeStatus(req, res, chargeMatch[1]);
    }

    if (path === '/v1/merchants/me' && method === 'GET') {
      return handleProfile(req, res);
    }

    if (path === '/v1/merchants/stats' && method === 'GET') {
      return handleStats(req, res);
    }

    if (path === '/v1/merchants/keys/rotate' && method === 'POST') {
      return handleRotateKeys(req, res);
    }

    json(res, 404, { success: false, message: 'Endpoint not found', timestamp: now() });
  } catch (error) {
    console.error('[Gateway] Error:', error);
    json(res, 500, { success: false, message: 'Internal server error', timestamp: now() });
  }
};
