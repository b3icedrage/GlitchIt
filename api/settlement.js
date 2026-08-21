// ═══════════════════════════════════════════════════════════════════════
// GlitchIt Vacuum — Settlement Engine + B2C Payout Service
//
// The "Vacuum" is the master corporate wallet that collects funds from
// successful STK Push payments and programmatically withdraws them to
// the owner's personal Safaricom phone via Daraja B2C API.
//
// Endpoints:
//   POST /v1/admin/withdraw      — Request a payout to a phone number
//   POST /v1/payout-callback     — Safaricom B2C async result listener
//   GET  /v1/admin/balance       — Current vault balance
//   GET  /v1/admin/ledger        — Ledger history
//   GET  /v1/admin/payouts       — Payout request history
//
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('node:crypto');
let Pool;
try { Pool = require('pg').Pool; } catch (e) { /* pg optional — DB features disabled */ }

// ─── Configuration (lazy) ───────────────────────────────────────────
function cfg(k, fb) { return process.env[k] || fb; }
function getDarajaKey()       { return cfg('DARAJA_CONSUMER_KEY', ''); }
function getDarajaSecret()    { return cfg('DARAJA_CONSUMER_SECRET', ''); }
function getDarajaShortcode() { return cfg('DARAJA_SHORTCODE', '174379'); }
function getDarajaPasskey()   { return cfg('DARAJA_PASSKEY', ''); }
function getDarajaInitiator() { return cfg('DARAJA_INITIATOR_NAME', 'glitchitapi'); }
function getDarajaEnv()       { return cfg('DARAJA_ENV', 'sandbox'); }
function getWithdrawPhone()   { return cfg('WITHDRAW_PHONE', '254143476934'); }
function getAdminSecret()     { return cfg('ADMIN_SECRET', 'glitchit-admin-2026'); }
function getDatabaseUrl()     { return cfg('DATABASE_URL', ''); }
function getDarajaBase() {
  return getDarajaEnv() === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// ─── Database ───────────────────────────────────────────────────────
let dbPool = null;
function getDb() {
  if (!dbPool && getDatabaseUrl()) {
    dbPool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
    dbPool.on('error', (e) => console.error('[Settlement/DB]', e.message));
  }
  return dbPool;
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
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function now() { return new Date().toISOString(); }

function formatPhone(phone) {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('+254')) d = d.slice(1);
  if (d.startsWith('254')) d = d.slice(3);
  d = d.replace(/^0+/, '');
  if (d.length >= 9) return '254' + d.slice(-9);
  return '254' + d.padStart(9, '0');
}

// ─── Daraja OAuth Token ─────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
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
  if (!token) throw new Error('No access_token in Daraja response');

  cachedToken = token;
  tokenExpiry = Date.now() + 3500000; // 58 min
  return token;
}

// ─── SecurityCredential (B2C) ───────────────────────────────────────
// Safaricom B2C requires the initiator password encrypted with their
// production RSA public key. In sandbox, a simple string works.
// This function generates the credential. In production, you'd encrypt
// the initiator password with Safaricom's cert via crypto.publicEncrypt.
function getSecurityCredential() {
  // Production: encrypt initiator password with Safaricom's public key
  const initiatorPassword = cfg('DARAJA_INITIATOR_PASSWORD', '');
  const publicKeyPem = cfg('DARAJA_PUBLIC_KEY', '');

  if (publicKeyPem && initiatorPassword) {
    const encrypted = crypto.publicEncrypt(
      { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(initiatorPassword)
    );
    return encrypted.toString('base64');
  }

  // Sandbox: use passkey as the security credential
  return cfg('DARAJA_SECURITY_CREDENTIAL', getDarajaPasskey() || 'sandbox-credential');
}

// ═══════════════════════════════════════════════════════════════════════
// THE VACUUM — Settlement Engine
// ═══════════════════════════════════════════════════════════════════════

/**
 * Credit the vault when a payment is successfully verified.
 * Called after STK Push callback or manual approval.
 * Idempotent: won't double-credit if tx_ref already exists in ledger.
 */
async function creditVault(db, { txRef, amount, source, description, meta }) {
  // Idempotency check
  const existing = await db.query('SELECT id FROM ledger_entries WHERE tx_ref = $1', [txRef]);
  if (existing.rows.length > 0) {
    console.log(`[Vacuum] ⚡ Idempotent skip — ${txRef} already in ledger`);
    return existing.rows[0].id;
  }

  // Ensure vault row exists (single-row table)
  await db.query(`INSERT INTO vault_balance (id, updated_at) SELECT gen_random_uuid(), NOW() WHERE NOT EXISTS (SELECT 1 FROM vault_balance)`);

  // Atomically credit the vault
  const result = await db.query(
    `UPDATE vault_balance SET
       total_credits = total_credits + $1,
       available = available + $1,
       updated_at = NOW()
     RETURNING available, total_credits, total_debits`,
    [amount]
  );

  const balance = result.rows[0];

  // Record ledger entry
  const ledgerId = crypto.randomUUID();
  await db.query(
    `INSERT INTO ledger_entries (id, tx_ref, type, amount, balance_after, source, description, meta, created_at)
     VALUES ($1, $2, 'CREDIT', $3, $4, $5, $6, $7, NOW())`,
    [ledgerId, txRef, amount, balance.available, source, description || `Payment received KES ${amount}`, meta || null]
  );

  console.log(`[Vacuum] 💰 CREDITED KES ${amount} → ${txRef} | Balance: KES ${balance.available}`);
  return ledgerId;
}

/**
 * Debit the vault when a payout is initiated.
 * Returns the ledger entry ID for idempotency.
 */
async function debitVault(db, { txRef, amount, source, description, meta }) {
  // Idempotency check
  const existing = await db.query('SELECT id FROM ledger_entries WHERE tx_ref = $1', [txRef]);
  if (existing.rows.length > 0) {
    console.log(`[Vacuum] ⚡ Idempotent skip — ${txRef} already in ledger`);
    return existing.rows[0].id;
  }

  // Check balance
  const bal = await db.query('SELECT available FROM vault_balance LIMIT 1');
  const available = bal.rows.length > 0 ? Number(bal.rows[0].available) : 0;
  if (available < amount) {
    throw new Error(`Insufficient balance: KES ${available} available, KES ${amount} requested`);
  }

  // Atomically debit the vault
  const result = await db.query(
    `UPDATE vault_balance SET
       total_debits = total_debits + $1,
       available = available - $1,
       pending_payouts = pending_payouts + $1,
       updated_at = NOW()
     RETURNING available, total_credits, total_debits, pending_payouts`,
    [amount]
  );

  const balance = result.rows[0];

  // Record ledger entry
  const ledgerId = crypto.randomUUID();
  await db.query(
    `INSERT INTO ledger_entries (id, tx_ref, type, amount, balance_after, source, description, meta, created_at)
     VALUES ($1, $2, 'DEBIT', $3, $4, $5, $6, $7, NOW())`,
    [ledgerId, txRef, amount, balance.available, source, description || `Payout KES ${amount}`, meta || null]
  );

  console.log(`[Vacuum] 📤 DEBITED KES ${amount} → ${txRef} | Balance: KES ${balance.available}`);
  return ledgerId;
}

/**
 * Reconcile a debit when a payout fails or is reversed.
 */
async function reconcileDebit(db, { txRef, amount, reason }) {
  await db.query(
    `UPDATE vault_balance SET
       available = available + $1,
       pending_payouts = pending_payouts - $1,
       updated_at = NOW()
     RETURNING available, pending_payouts`,
    [amount]
  );

  const ledgerId = crypto.randomUUID();
  const reversalRef = `rev-${txRef}-${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO ledger_entries (id, tx_ref, type, amount, balance_after, source, description, meta, created_at)
     VALUES ($1, $2, 'CREDIT', $3, (SELECT available FROM vault_balance LIMIT 1), 'PAYOUT_REVERSAL', $4, $5, NOW())`,
    [ledgerId, reversalRef, amount, `Payout reversed: ${reason}`, JSON.stringify({ original_tx_ref: txRef, reason })]
  );

  console.log(`[Vacuum] ↩️ REVERSED KES ${amount} — ${reason}`);
}

// ═══════════════════════════════════════════════════════════════════════
// B2C Payout Service — Safaricom Business-to-Customer
// ═══════════════════════════════════════════════════════════════════════

async function initiateB2CPayout({ amount, recipientPhone, idempotencyKey, commandId = 'BusinessPayment', remarks = 'GlitchIt Payout', occasion = 'Vault Withdrawal' }) {
  const token = await getAccessToken();
  const phone = formatPhone(recipientPhone);
  const shortcode = getDarajaShortcode();
  const initiator = getDarajaInitiator();
  const securityCredential = getSecurityCredential();

  const payload = {
    InitiatorName: initiator,
    SecurityCredential: securityCredential,
    CommandID: commandId,
    Amount: Math.round(amount),
    PartyA: shortcode,
    PartyB: phone,
    Remarks: remarks,
    Occasion: occasion,
    QueueTimeOutURL: `https://glitchit.app/v1/payout-callback`,
    ResultURL: `https://glitchit.app/v1/payout-callback`,
    OriginatorConversationID: idempotencyKey,
    ConversationID: idempotencyKey,
  };

  console.log(`[B2C] 📤 Initiating payout: KES ${amount} → ${phone} (idempotency: ${idempotencyKey})`);

  const res = await fetch(`${getDarajaBase()}/mpesa/b2c/v1/paymentrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  const data = await res.json();
  console.log(`[B2C] Daraja response:`, JSON.stringify(data).slice(0, 300));

  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// Route Handlers
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /v1/admin/withdraw — Request a payout
 * Protected by ADMIN_SECRET header.
 */
async function handleWithdraw(req, res) {
  // Admin auth check
  const adminKey = req.headers['x-admin-secret'] || '';
  if (!adminKey || adminKey !== getAdminSecret()) {
    return json(res, 403, { success: false, message: 'Unauthorized', timestamp: now() });
  }

  const body = await readBody(req);
  if (!body) return json(res, 400, { success: false, message: 'Invalid JSON', timestamp: now() });

  // Validate amount
  if (!body.amount || body.amount <= 0) {
    return json(res, 400, { success: false, message: 'amount must be positive', timestamp: now() });
  }
  if (body.amount > 150000) {
    return json(res, 400, { success: false, message: 'Max single withdrawal: KES 150,000 (Safaricom B2C limit)', timestamp: now() });
  }

  // Generate idempotency key (unique per withdrawal request)
  const idempotencyKey = body.idempotency_key || `WD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  // ── IDEMPOTENCY GUARD ──
  // Check if this exact key already exists
  const existing = await pool.query(
    'SELECT id, status, amount FROM payout_requests WHERE idempotency_key = $1',
    [idempotencyKey]
  );
  if (existing.rows.length > 0) {
    const p = existing.rows[0];
    return json(res, 200, {
      success: true,
      message: `Payout already ${p.status.toLowerCase()} (idempotent)`,
      data: { payout_id: p.id, status: p.status, amount: Number(p.amount), idempotency_key: idempotencyKey },
      timestamp: now(),
    });
  }

  // Check for any pending/processing payouts (prevent concurrent)
  const pending = await pool.query(
    "SELECT id FROM payout_requests WHERE status IN ('PENDING', 'PROCESSING')"
  );
  if (pending.rows.length > 0) {
    return json(res, 409, {
      success: false,
      message: 'A payout is already being processed. Wait for completion before requesting another.',
      timestamp: now(),
    });
  }

  // Check balance
  const balResult = await pool.query('SELECT available FROM vault_balance LIMIT 1');
  const available = balResult.rows.length > 0 ? Number(balResult.rows[0].available) : 0;
  if (available < body.amount) {
    return json(res, 400, {
      success: false,
      message: `Insufficient balance. Available: KES ${available.toLocaleString()}, Requested: KES ${body.amount.toLocaleString()}`,
      timestamp: now(),
    });
  }

  // ── Create payout record (PROCESSING state) ──
  const payoutId = crypto.randomUUID();
  const recipient = formatPhone(body.phone || getWithdrawPhone());

  await pool.query(
    `INSERT INTO payout_requests (id, idempotency_key, amount, recipient_phone, status, command_id, initiator_name, requested_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'PROCESSING', $5, $6, $7, NOW(), NOW())`,
    [payoutId, idempotencyKey, body.amount, recipient, body.command_id || 'BusinessPayment', getDarajaInitiator(), body.admin_user || 'system']
  );

  // ── Debit vault atomically ──
  try {
    await debitVault(pool, {
      txRef: idempotencyKey,
      amount: body.amount,
      source: 'B2C_PAYOUT',
      description: `B2C payout to ${recipient}`,
      meta: JSON.stringify({ payout_id: payoutId, recipient }),
    });
  } catch (e) {
    // Revert payout record
    await pool.query("UPDATE payout_requests SET status = 'FAILED', result_description = $1 WHERE id = $2", [e.message, payoutId]);
    return json(res, 400, { success: false, message: e.message, timestamp: now() });
  }

  // ── Fire B2C request to Safaricom ──
  try {
    const b2cResult = await initiateB2CPayout({
      amount: body.amount,
      recipientPhone: recipient,
      idempotencyKey,
      commandId: body.command_id || 'BusinessPayment',
      remarks: body.remarks || 'GlitchIt Vault Withdrawal',
      occasion: body.occasion || 'Withdrawal to personal M-Pesa',
    });

    if (b2cResult.ResponseCode === '0' || b2cResult.ResponseCode === '0' || b2cResult.ConversationID) {
      // B2C request accepted
      await pool.query(
        `UPDATE payout_requests SET
           status = 'PROCESSING',
           conversation_id = $1,
           security_credential = $2,
           updated_at = NOW()
         WHERE id = $3`,
        [b2cResult.ConversationID || idempotencyKey, null, payoutId]
      );

      console.log(`[Vacuum] ✅ B2C payout accepted: KES ${body.amount} → ${recipient} (conv: ${b2cResult.ConversationID})`);

      json(res, 200, {
        success: true,
        message: 'Payout request accepted by Safaricom. Waiting for confirmation.',
        data: {
          payout_id: payoutId,
          idempotency_key: idempotencyKey,
          amount: body.amount,
          recipient: recipient,
          status: 'PROCESSING',
          conversation_id: b2cResult.ConversationID,
        },
        timestamp: now(),
      });
    } else {
      // B2C request rejected by Safaricom — revert vault
      const errMsg = b2cResult.errorMessage || b2cResult.ResponseDescription || 'B2C request rejected';
      await pool.query("UPDATE payout_requests SET status = 'FAILED', result_code = $1, result_description = $2, updated_at = NOW() WHERE id = $3",
        [b2cResult.ErrorCode || -1, errMsg, payoutId]);
      await reconcileDebit(pool, { txRef: idempotencyKey, amount: body.amount, reason: errMsg });

      json(res, 400, {
        success: false,
        message: `Safaricom rejected: ${errMsg}`,
        data: { payout_id: payoutId, idempotency_key: idempotencyKey },
        timestamp: now(),
      });
    }
  } catch (err) {
    // Network/timeout error — revert vault, mark for retry
    await pool.query("UPDATE payout_requests SET status = 'FAILED', result_description = $1, retry_count = retry_count + 1, updated_at = NOW() WHERE id = $2",
      [err.message, payoutId]);
    await reconcileDebit(pool, { txRef: idempotencyKey, amount: body.amount, reason: err.message });

    json(res, 502, {
      success: false,
      message: `B2C request failed: ${err.message}. Vault funds restored.`,
      data: { payout_id: payoutId, idempotency_key: idempotencyKey },
      timestamp: now(),
    });
  }
}

/**
 * POST /v1/payout-callback — Safaricom B2C async result listener
 * Safaricom calls this when the B2C payment completes or fails.
 */
async function handlePayoutCallback(req, res) {
  console.log(`[Vacuum] 📥 Payout callback received`);

  const body = await readBody(req);

  // Safaricom B2C callback format
  const result = body?.Result || body;
  const resultType = result?.ResultType;
  const resultCode = result?.ResultCode;
  const resultDesc = result?.ResultDesc;
  const conversationId = result?.ConversationID;
  const originatorConversationId = result?.OriginatorConversationID;
  const transactionId = result?.TransactionID;

  console.log(`[Vacuum] Callback: conv=${conversationId} code=${resultCode} desc=${resultDesc}`);

  const pool = getDb();
  if (!pool) return json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });

  // Find the payout by conversation ID or idempotency key
  let payout = null;
  if (conversationId) {
    const r = await pool.query('SELECT * FROM payout_requests WHERE conversation_id = $1', [conversationId]);
    if (r.rows.length > 0) payout = r.rows[0];
  }
  if (!payout && originatorConversationId) {
    const r = await pool.query('SELECT * FROM payout_requests WHERE idempotency_key = $1', [originatorConversationId]);
    if (r.rows.length > 0) payout = r.rows[0];
  }

  if (!payout) {
    console.log(`[Vacuum] ⚠️ No matching payout for conv=${conversationId}`);
    return json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
  }

  // Parse B2C result details
  const b2cResult = result?.ResultParameters?.ResultParameter || [];
  const resultParams = {};
  if (Array.isArray(b2cResult)) {
    b2cResult.forEach((p) => { resultParams[p.Key] = p.Value; });
  }
  const mpesaReceipt = resultParams?.TransactionReceipt || null;
  const receiverParty = resultParams?.ReceiverPartyPublicName || null;

  if (resultCode === 0 || resultCode === '0') {
    // ✅ B2C SUCCESSFUL — money is in the recipient's phone
    await pool.query(
      `UPDATE payout_requests SET
         status = 'SUCCESSFUL',
         result_code = 0,
         result_description = $1,
         mpesa_receipt = $2,
         processed_at = NOW(),
         updated_at = NOW()
       WHERE id = $3`,
      [resultDesc, mpesaReceipt, payout.id]
    );

    // Reduce pending_payouts (the debit already happened)
    await pool.query(
      `UPDATE vault_balance SET pending_payouts = GREATEST(pending_payouts - $1, 0), updated_at = NOW()`,
      [payout.amount]
    );

    console.log(`[Vacuum] ✅ B2C SUCCESSFUL: KES ${payout.amount} → ${payout.recipient_phone} | Receipt: ${mpesaReceipt}`);
    console.log(`[Vacuum] 📱 Money deposited to ${receiverParty || payout.recipient_phone}`);
  } else {
    // ❌ B2C FAILED — revert the vault debit
    await pool.query(
      `UPDATE payout_requests SET
         status = 'FAILED',
         result_code = $1,
         result_description = $2,
         processed_at = NOW(),
         updated_at = NOW()
       WHERE id = $3`,
      [resultCode, resultDesc, payout.id]
    );

    // Restore funds to available balance
    await reconcileDebit(pool, {
      txRef: payout.idempotency_key,
      amount: payout.amount,
      reason: `B2C failed: code=${resultCode} ${resultDesc}`,
    });

    console.log(`[Vacuum] ❌ B2C FAILED: code=${resultCode} ${resultDesc} | KES ${payout.amount} restored`);
  }

  // Acknowledge to Safaricom
  json(res, 200, { ResultCode: 0, ResultDesc: 'OK' });
}

/**
 * GET /v1/admin/balance — Current vault balance
 */
async function handleBalance(req, res) {
  const adminKey = req.headers['x-admin-secret'] || '';
  if (!adminKey || adminKey !== getAdminSecret()) {
    return json(res, 403, { success: false, message: 'Unauthorized', timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  // Ensure vault row exists
  await pool.query(`INSERT INTO vault_balance (id, updated_at) SELECT gen_random_uuid(), NOW() WHERE NOT EXISTS (SELECT 1 FROM vault_balance)`);

  const result = await pool.query('SELECT * FROM vault_balance LIMIT 1');
  const vault = result.rows[0] || { total_credits: 0, total_debits: 0, available: 0, pending_payouts: 0 };

  json(res, 200, {
    success: true,
    data: {
      available: Number(vault.available),
      total_credits: Number(vault.total_credits),
      total_debits: Number(vault.total_debits),
      pending_payouts: Number(vault.pending_payouts),
      currency: 'KES',
    },
    timestamp: now(),
  });
}

/**
 * GET /v1/admin/ledger — Ledger history (credits + debits)
 */
async function handleLedger(req, res) {
  const adminKey = req.headers['x-admin-secret'] || '';
  if (!adminKey || adminKey !== getAdminSecret()) {
    return json(res, 403, { success: false, message: 'Unauthorized', timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const url = new URL(req.url, 'http://glitchit.local');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const result = await pool.query(
    'SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  json(res, 200, {
    success: true,
    data: result.rows.map((e) => ({
      id: e.id,
      tx_ref: e.tx_ref,
      type: e.type,
      amount: Number(e.amount),
      balance_after: Number(e.balance_after),
      source: e.source,
      description: e.description,
      meta: e.meta ? JSON.parse(e.meta) : null,
      created_at: e.created_at,
    })),
    timestamp: now(),
  });
}

/**
 * GET /v1/admin/payouts — Payout request history
 */
async function handlePayouts(req, res) {
  const adminKey = req.headers['x-admin-secret'] || '';
  if (!adminKey || adminKey !== getAdminSecret()) {
    return json(res, 403, { success: false, message: 'Unauthorized', timestamp: now() });
  }

  const pool = getDb();
  if (!pool) return json(res, 500, { success: false, message: 'Database not configured', timestamp: now() });

  const url = new URL(req.url, 'http://glitchit.local');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const result = await pool.query(
    'SELECT * FROM payout_requests ORDER BY created_at DESC LIMIT $1',
    [limit]
  );

  json(res, 200, {
    success: true,
    data: result.rows.map((p) => ({
      payout_id: p.id,
      idempotency_key: p.idempotency_key,
      amount: Number(p.amount),
      recipient_phone: p.recipient_phone,
      status: p.status,
      command_id: p.command_id,
      conversation_id: p.conversation_id,
      result_code: p.result_code,
      result_description: p.result_description,
      mpesa_receipt: p.mpesa_receipt,
      retry_count: p.retry_count,
      processed_at: p.processed_at,
      created_at: p.created_at,
    })),
    timestamp: now(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════

module.exports = async function settlementHandler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const path = url.pathname;
  const method = req.method;

  try {
    // CORS
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    // Payout callback from Safaricom (no auth — Safaricom calls this)
    if (path === '/v1/payout-callback' && method === 'POST') {
      return handlePayoutCallback(req, res);
    }

    // Admin endpoints (require X-Admin-Secret header)
    if (path === '/v1/admin/withdraw' && method === 'POST') {
      return handleWithdraw(req, res);
    }
    if (path === '/v1/admin/balance' && method === 'GET') {
      return handleBalance(req, res);
    }
    if (path === '/v1/admin/ledger' && method === 'GET') {
      return handleLedger(req, res);
    }
    if (path === '/v1/admin/payouts' && method === 'GET') {
      return handlePayouts(req, res);
    }

    return null; // Not handled here
  } catch (error) {
    console.error('[Settlement] Error:', error);
    json(res, 500, { success: false, message: 'Internal server error', timestamp: now() });
  }
};

// ─── Export helpers for use by other modules ─────────────────────────
module.exports.creditVault = creditVault;
module.exports.debitVault = debitVault;
module.exports.reconcileDebit = reconcileDebit;
