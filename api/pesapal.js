'use strict';

// ─── PesaPal API v3 Integration ──────────────────────────────────────
// Flow: Client calls POST /api/pesapal/order → server gets OAuth token →
// submits order → returns redirect_url → user pays on PesaPal hosted page →
// PesaPal calls POST /api/pesapal/ipn → server verifies transaction.

const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY || 'AFgF1I7qmrZ+Celn/J1eJuaBBoitmZQK';
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET || 'ypkqWl6p2tgyajQ2g8+wsXMBvxQ=';

// PesaPal base URLs (sandbox vs production)
function getPesapalBase() {
  const env = (process.env.PESAPAL_ENV || 'production').toLowerCase();
  return env === 'sandbox'
    ? 'https://sandbox.pesapal.com/v3'
    : 'https://pay.pesapal.com/v3/api';
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

function generateOrderRef() {
  const ts = Date.now().toString(36).slice(-6).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GLT-PP-${ts}-${rand}`;
}

// ─── OAuth 1.0 Token ───────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

function base64(str) { return Buffer.from(str).toString('base64'); }

function oauth1Sign(method, url, params, consumerSecret) {
  const sorted = Object.keys(params).sort().map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const baseString = method.toUpperCase() + '&' + encodeURIComponent(url) + '&' + encodeURIComponent(sorted);
  const { createHmac } = require('node:crypto');
  return createHmac('sha1', consumerSecret + '&').update(baseString).digest('base64');
}

async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const base = getPesapalBase();
  const authUrl = base + '/Auth/GetToken';
  
  // Method 1: JSON body POST (standard PesaPal API v3)
  try {
    const res = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ConsumerKey: PESAPAL_CONSUMER_KEY, ConsumerSecret: PESAPAL_CONSUMER_SECRET }),
      signal: AbortSignal.timeout(15000),
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('json') || text.trim().startsWith('{')) {
      const data = JSON.parse(text);
      if (data.token) {
        cachedToken = data.token;
        tokenExpiry = Date.now() + 4 * 60 * 1000;
        console.log('[PesaPal] ✅ OAuth token (JSON body)');
        return cachedToken;
      }
    }
  } catch (e) { console.warn('[PesaPal] JSON auth failed:', e.message); }

  // Method 2: Basic auth header
  try {
    const creds = base64(PESAPAL_CONSUMER_KEY + ':' + PESAPAL_CONSUMER_SECRET);
    const res = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + creds },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('json') || text.trim().startsWith('{')) {
      const data = JSON.parse(text);
      if (data.token) {
        cachedToken = data.token;
        tokenExpiry = Date.now() + 4 * 60 * 1000;
        console.log('[PesaPal] ✅ OAuth token (Basic auth)');
        return cachedToken;
      }
    }
  } catch (e) { console.warn('[PesaPal] Basic auth failed:', e.message); }

  // Method 3: OAuth 1.0a signed request
  try {
    const nonce = require('node:crypto').randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const params = {
      oauth_consumer_key: PESAPAL_CONSUMER_KEY,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_version: '1.0',
    };
    params.oauth_signature = oauth1Sign('POST', authUrl, params, PESAPAL_CONSUMER_SECRET);
    const authHeader = 'OAuth ' + Object.entries(params).map(([k,v]) => k + '="' + encodeURIComponent(v) + '"').join(', ');
    
    const res = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('json') || text.trim().startsWith('{')) {
      const data = JSON.parse(text);
      if (data.token) {
        cachedToken = data.token;
        tokenExpiry = Date.now() + 4 * 60 * 1000;
        console.log('[PesaPal] ✅ OAuth token (OAuth 1.0a)');
        return cachedToken;
      }
    }
  } catch (e) { console.warn('[PesaPal] OAuth 1.0a failed:', e.message); }

  throw new Error('PesaPal authentication failed with all methods. Verify your credentials at pesapal.com/dashboard.');
}

// ─── POST /api/pesapal/order ───────────────────────────────────────
// Creates an order on PesaPal and returns the redirect URL for the
// hosted payment page (cards, M-Pesa, Airtel Money, bank transfer).
async function handleCreateOrder(req, res) {
  const body = await readBody(req);
  if (!body || !body.amount || body.amount <= 0) {
    return json(res, 400, { ok: false, error: 'Valid amount required' });
  }

  const amount = Number(body.amount);
  const description = body.description || 'GlitchIt Payment';
  const email = body.email || '';
  const phone = body.phone || '';
  const firstName = body.firstName || '';
  const lastName = body.lastName || '';
  const orderId = body.orderId || generateOrderRef();

  // Build the base URL — must match the domain where this app is deployed
  const host = process.env.PESAPAL_CALLBACK_DOMAIN || req.headers.host || 'glitch-itr.vercel.app';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${protocol}://${host}`;

  // `callback_url` is where PesaPal redirects the customer's BROWSER after
  // hosted checkout. It must land on the premium page so our ?from_pesapal=1
  // logic activates the badge. (PesaPal appends OrderTrackingId /
  // OrderMerchantReference / OrderNotificationType, which this page tolerates.)
  const callbackUrl = `${baseUrl}/premium.html?from_pesapal=1`;

  // The IPN endpoint (/api/pesapal/ipn) is a SEPARATE server-to-server
  // notification, registered once via PesaPal's RegisterIPNURL / dashboard
  // (its returned ipn_id would go in notification_id below). It is NOT the
  // browser return target, so it is intentionally not used as callback_url.
  const ipnUrl = `${baseUrl}/api/pesapal/ipn`;
  console.log('[PesaPal] Browser callback URL:', callbackUrl);
  console.log('[PesaPal] IPN URL (register in dashboard):', ipnUrl);

  try {
    const token = await getOAuthToken();
    const base = getPesapalBase();

    const orderPayload = {
      id: orderId,
      currency: body.currency || 'KES',
      amount: amount,
      description: description,
      callback_url: callbackUrl,
      notification_id: '', // IPN notification ID (register separately if needed)
      billing_address: {
        email_address: email,
        phone_number: phone,
        country_code: body.countryCode || 'KE',
        first_name: firstName,
        middle_name: '',
        last_name: lastName,
        line_1: '',
        line_2: '',
        city: '',
        state: '',
        postal_code: '',
        zip_code: '',
      },
    };

    console.log(`[PesaPal] 📤 Creating order: ${orderId} KES ${amount}`);

    const orderRes = await fetch(`${base}/api/SubmitOrderRequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(30000),
    });

    const orderData = await orderRes.json();
    console.log(`[PesaPal] Order response:`, JSON.stringify(orderData).slice(0, 300));

    if (orderRes.ok && orderData.redirect_url) {
      return json(res, 200, {
        ok: true,
        order_id: orderId,
        redirect_url: orderData.redirect_url,
        order_tracking_id: orderData.order_tracking_id || '',
        message: 'Redirecting to PesaPal checkout...',
      });
    }

    // Error from PesaPal
    const errMsg = orderData.message || orderData.error || JSON.stringify(orderData);
    console.error(`[PesaPal] ❌ Order failed:`, errMsg);
    return json(res, 400, { ok: false, error: `Payment provider error: ${errMsg}` });

  } catch (err) {
    console.error(`[PesaPal] ❌ Order exception:`, err.message);
    return json(res, 500, { ok: false, error: 'Payment service temporarily unavailable. Please try again.' });
  }
}

// ─── POST /api/pesapal/ipn ────────────────────────────────────────
// PesaPal sends Instant Payment Notification here after payment.
// We verify the transaction and update the order status.
async function handleIPN(req, res) {
  console.log(`[PesaPal] 📥 IPN received`);

  const body = await readBody(req);
  const { OrderTrackingId, OrderNotificationType, MerchantReference } = body || {};

  if (!OrderTrackingId) {
    console.log(`[PesaPal] IPN missing OrderTrackingId`);
    return json(res, 200, { ok: true, message: 'No tracking ID' });
  }

  console.log(`[PesaPal] IPN: tracking=${OrderTrackingId} ref=${MerchantReference} type=${OrderNotificationType}`);

  try {
    // Verify the transaction status with PesaPal
    const token = await getOAuthToken();
    const base = getPesapalBase();

    const statusRes = await fetch(
      `${base}/api/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      }
    );

    const statusData = await statusRes.json();
    console.log(`[PesaPal] Status verification:`, JSON.stringify(statusData).slice(0, 300));

    const status = (statusData.status || '').toUpperCase();
    const paymentMethod = statusData.payment_method || '';
    const amount = statusData.amount || 0;
    const currency = statusData.currency || 'KES';
    const paymentAccount = statusData.payment_account || '';
    const paymentReference = statusData.payment_reference || '';

    // Log the confirmed payment
    console.log(`[PesaPal] ${status === 'COMPLETED' ? '✅' : '⏳'} ${OrderTrackingId}: ${status} ${currency} ${amount} via ${paymentMethod}`);

    // In a real app, you'd update the order in your database here
    // e.g., await db.query('UPDATE orders SET status = $1 WHERE reference = $2', [status, MerchantReference]);

  } catch (err) {
    console.error(`[PesaPal] IPN verification error:`, err.message);
  }

  // Always return 200 to PesaPal so it doesn't retry
  json(res, 200, { ok: true });
}

// ─── GET /api/pesapal/status?tracking=... ──────────────────────────
// Client polls this to check if payment completed.
async function handleStatus(req, res, url) {
  const trackingId = url.searchParams.get('tracking');
  const orderId = url.searchParams.get('order_id');

  if (!trackingId && !orderId) {
    return json(res, 400, { ok: false, error: 'tracking or order_id required' });
  }

  try {
    const token = await getOAuthToken();
    const base = getPesapalBase();

    if (trackingId) {
      const statusRes = await fetch(
        `${base}/api/GetTransactionStatus?orderTrackingId=${trackingId}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        }
      );

      const data = await statusRes.json();
      const status = (data.status || '').toUpperCase();

      if (status === 'COMPLETED') {
        return json(res, 200, {
          ok: true,
          status: 'completed',
          amount: data.amount,
          currency: data.currency || 'KES',
          payment_method: data.payment_method || '',
          order_id: data.merchant_reference || orderId || '',
        });
      }

      if (status === 'FAILED' || status === 'CANCELLED') {
        return json(res, 200, {
          ok: false,
          status: status.toLowerCase(),
          error: `Payment ${status.toLowerCase()}`,
        });
      }

      // Still pending
      return json(res, 202, {
        ok: false,
        status: 'pending',
        pending: true,
        message: 'Waiting for payment...',
      });
    }
  } catch (err) {
    console.error(`[PesaPal] Status check error:`, err.message);
  }

  json(res, 202, { ok: false, status: 'pending', pending: true });
}

// ─── GET /api/pesapal/config ───────────────────────────────────────
function handleConfig(req, res) {
  const env = (process.env.PESAPAL_ENV || 'production').toLowerCase();
  json(res, 200, {
    ok: true,
    configured: Boolean(PESAPAL_CONSUMER_KEY && PESAPAL_CONSUMER_SECRET),
    environment: env,
    base_url: getPesapalBase(),
    note: env === 'sandbox' 
      ? 'Sandbox mode — credentials must be sandbox keys from sandbox.pesapal.com'
      : 'Production mode — credentials must be live keys from pesapal.com dashboard',
  });
}

// ─── Router ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const method = req.method;
  const path = url.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (method === 'POST' && path === '/api/pesapal/order') return handleCreateOrder(req, res);
  if (method === 'POST' && path === '/api/pesapal/ipn') return handleIPN(req, res);
  if (method === 'GET' && path === '/api/pesapal/status') return handleStatus(req, res, url);
  if (method === 'GET' && path === '/api/pesapal/config') return handleConfig(req, res);

  json(res, 404, { ok: false, error: 'Not found' });
};
