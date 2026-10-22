'use strict';
// Auth-guard tests for the hardened endpoints:
//   • /api/payment/approve|reject|pending  — admin secret required (fail-closed)
//   • /api/livekit-token                   — Firebase ID token required
//   • /api/payment/ipn                     — must stay public (PesaPal calls it)
//
// These exercise the HTTP surface with fake req/res objects — no network, no
// DB. Payment handlers fall through to the DB-absent path once auth passes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const payment = require('../api/payment.js');
const livekit = require('../api/livekit-token.js');

// Minimal req/res doubles. Payment's readBody() consumes the request as a
// stream, so req is a Readable carrying the JSON body.
function makeReq({ method = 'GET', url = '/', headers = {}, body = {} } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function makeRes() {
  const res = {
    statusCode: 0,
    payload: null,
    headers: {},
    writeHead(status, hdrs) { this.statusCode = status; Object.assign(this.headers, hdrs || {}); },
    setHeader(k, v) { this.headers[k] = v; },
    end(data) { if (data) this.payload = JSON.parse(data); },
  };
  return res;
}

// ─── /api/payment admin routes ──────────────────────────────────────

for (const route of [
  { method: 'POST', url: '/api/payment/approve', body: { tx_ref: 'GLT-TEST' } },
  { method: 'POST', url: '/api/payment/reject', body: { tx_ref: 'GLT-TEST' } },
  { method: 'GET', url: '/api/payment/pending' },
]) {
  test(`payment ${route.url} fails closed (503) with ADMIN_SECRET unset`, async () => {
    const prev = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    try {
      const res = makeRes();
      await payment(makeReq({ ...route, headers: { 'x-admin-secret': 'glitchit-admin-2026' } }), res);
      assert.equal(res.statusCode, 503, 'the old committed default must not work');
      assert.match(res.payload.error, /not configured/i);
    } finally {
      if (prev !== undefined) process.env.ADMIN_SECRET = prev;
    }
  });

  test(`payment ${route.url} rejects a wrong secret with 403`, async () => {
    const prev = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = 'right-secret';
    try {
      const res = makeRes();
      await payment(makeReq({ ...route, headers: { 'x-admin-secret': 'wrong' } }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.payload.ok, false);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = prev;
    }
  });

  test(`payment ${route.url} passes auth with the right secret (no DB → graceful)`, async () => {
    const prev = process.env.ADMIN_SECRET;
    const prevDb = process.env.DATABASE_URL;
    process.env.ADMIN_SECRET = 'right-secret';
    delete process.env.DATABASE_URL;
    try {
      const res = makeRes();
      await payment(makeReq({ ...route, headers: { 'x-admin-secret': 'right-secret' } }), res);
      assert.notEqual(res.statusCode, 403, 'must not be an auth failure');
      assert.notEqual(res.statusCode, 503, 'must be configured');
    } finally {
      if (prev === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = prev;
      if (prevDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDb;
    }
  });
}

test('payment IPN callback stays public (no auth header, no rejection)', async () => {
  const res = makeRes();
  await payment(makeReq({
    method: 'POST',
    url: '/api/payment/ipn',
    body: { OrderTrackingId: 'OT-1', TransactionStatus: 'FAILED' },
  }), res);
  assert.equal(res.statusCode, 200, 'PesaPal must be able to reach the IPN without credentials');
  assert.equal(res.payload.ResultCode, 0);
});

// ─── /api/livekit-token ─────────────────────────────────────────────

test('livekit-token 401 without an Authorization header', async () => {
  const res = makeRes();
  await livekit(makeReq({ method: 'GET', url: '/api/livekit-token?room=r1&identity=x' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});

test('livekit-token 401 with a malformed/garbage Bearer token', async () => {
  const res = makeRes();
  await livekit(makeReq({
    method: 'GET',
    url: '/api/livekit-token?room=r1&identity=x',
    headers: { authorization: 'Bearer not-a-real-jwt' },
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});

test('livekit-token 405 on non-GET', async () => {
  const res = makeRes();
  await livekit(makeReq({ method: 'POST', url: '/api/livekit-token' }), res);
  assert.equal(res.statusCode, 405);
});
