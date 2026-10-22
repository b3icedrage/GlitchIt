'use strict';
// Ledger tests for the Vacuum settlement engine (api/settlement.js).
// Runs against a fake `db` that answers the exact SQL shapes the engine uses,
// so the money math (credits, debits, idempotency, reversal) is verified
// without a Postgres instance.
//
// Note: require() must happen AFTER the env is set, but the module reads env
// lazily inside handlers, so we only need ADMIN_SECRET set before the guard
// tests run.

const test = require('node:test');
const assert = require('node:assert/strict');

const settlement = require('../api/settlement.js');
const { creditVault, debitVault, reconcileDebit } = settlement;

// ─── Fake database ──────────────────────────────────────────────────
// Mimics Pool.query for the three ledger operations. State lives in a plain
// object so each test starts fresh via resetDb().
function makeFakeDb(initial) {
  const state = {
    ledger: [],          // rows that hit ledger_entries
    vault: {
      available: initial.available,
      total_credits: initial.total_credits ?? initial.available,
      total_debits: initial.total_debits ?? 0,
      pending_payouts: initial.pending_payouts ?? 0,
    },
  };

  const db = {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim().toUpperCase();

      if (q.startsWith('SELECT ID FROM LEDGER_ENTRIES WHERE TX_REF')) {
        const found = state.ledger.find((r) => r.tx_ref === params[0]);
        return { rows: found ? [{ id: found.id }] : [] };
      }

      if (q.startsWith('INSERT INTO VAULT_BALANCE')) {
        return { rows: [] }; // row always exists in the fake
      }

      if (q.startsWith('UPDATE VAULT_BALANCE')) {
        // Branch on the exact shapes the engine issues (checked in engine
        // order: debit has BOTH pending+1 and available-1, so pending shape
        // is matched first and must apply the debit direction).
        if (q.includes('PENDING_PAYOUTS = PENDING_PAYOUTS + $1')) {
          // debitVault: pending up, available down, debits up
          state.vault.pending_payouts += params[0];
          state.vault.total_debits += params[0];
          state.vault.available -= params[0];
        } else if (q.includes('PENDING_PAYOUTS = PENDING_PAYOUTS - $1')) {
          // reconcileDebit: pending down, available restored
          state.vault.pending_payouts -= params[0];
          state.vault.available += params[0];
        } else if (q.includes('PENDING_PAYOUTS = GREATEST(PENDING_PAYOUTS - $1, 0)')) {
          state.vault.pending_payouts = Math.max(state.vault.pending_payouts - params[0], 0);
        } else if (q.includes('AVAILABLE = AVAILABLE + $1')) {
          // creditVault: credits up, available up
          state.vault.total_credits += params[0];
          state.vault.available += params[0];
        } else {
          throw new Error('unexpected vault UPDATE: ' + q);
        }
        return {
          rows: [{
            available: state.vault.available,
            total_credits: state.vault.total_credits,
            total_debits: state.vault.total_debits,
            pending_payouts: state.vault.pending_payouts,
          }],
        };
      }

      if (q.startsWith('SELECT AVAILABLE FROM VAULT_BALANCE LIMIT 1')) {
        return { rows: [{ available: state.vault.available }] };
      }

      if (q.startsWith('INSERT INTO LEDGER_ENTRIES')) {
        // Shapes (type/source are SQL literals, not bind params):
        //   credit/debit: ($1,$2,'CREDIT',$3,$4,$5,$6,$7,NOW())
        //     → [id, tx_ref, amount, balance_after, source, description, meta]
        //   reversal:     ($1,$2,'CREDIT',$3,(SELECT …),'PAYOUT_REVERSAL',$4,$5,NOW())
        //     → [id, tx_ref, amount, description, meta]
        const type = (q.match(/VALUES \(\$1, \$2, '([A-Z_]+)'/) || [])[1] || '';
        const isReversal = q.includes("'PAYOUT_REVERSAL'");
        if (isReversal) {
          const [id, tx_ref, amount, description] = params;
          state.ledger.push({ id, tx_ref, type, amount, balance_after: null, source: 'PAYOUT_REVERSAL', description });
        } else {
          const [id, tx_ref, amount, balance_after, source, description] = params;
          state.ledger.push({ id, tx_ref, type, amount, balance_after, source, description });
        }
        return { rows: [] };
      }

      throw new Error('fake db got unexpected SQL: ' + q);
    },
  };
  return db;
}

// ─── creditVault ────────────────────────────────────────────────────

test('creditVault increases available balance and writes a CREDIT row', async () => {
  const db = makeFakeDb({ available: 0 });
  const id = await creditVault(db, { txRef: 'TX-1', amount: 1500, source: 'STK', description: 'test' });
  assert.ok(id, 'returns a ledger id');
  assert.equal(db.state.vault.available, 1500);
  assert.equal(db.state.vault.total_credits, 1500);
  assert.equal(db.state.ledger.length, 1);
  assert.equal(db.state.ledger[0].type, 'CREDIT');
  assert.equal(db.state.ledger[0].balance_after, 1500);
});

test('creditVault is idempotent on tx_ref (never double-credits)', async () => {
  const db = makeFakeDb({ available: 0 });
  await creditVault(db, { txRef: 'TX-SAME', amount: 900, source: 'STK' });
  const second = await creditVault(db, { txRef: 'TX-SAME', amount: 900, source: 'STK' });
  assert.equal(db.state.vault.available, 900, 'balance credited exactly once');
  assert.equal(db.state.ledger.length, 1, 'only one ledger row');
  assert.equal(second, db.state.ledger[0].id, 'second call returns the original id');
});

// ─── debitVault ─────────────────────────────────────────────────────

test('debitVault decreases available and tracks pending payouts', async () => {
  const db = makeFakeDb({ available: 5000 });
  await debitVault(db, { txRef: 'WD-1', amount: 2000, source: 'B2C_PAYOUT' });
  assert.equal(db.state.vault.available, 3000);
  assert.equal(db.state.vault.total_debits, 2000);
  assert.equal(db.state.vault.pending_payouts, 2000);
  assert.equal(db.state.ledger[0].type, 'DEBIT');
  assert.equal(db.state.ledger[0].balance_after, 3000);
});

test('debitVault refuses to overdraw the vault', async () => {
  const db = makeFakeDb({ available: 100 });
  await assert.rejects(
    () => debitVault(db, { txRef: 'WD-TOO-MUCH', amount: 5000, source: 'B2C_PAYOUT' }),
    /Insufficient balance/,
  );
  assert.equal(db.state.vault.available, 100, 'balance untouched after refusal');
  assert.equal(db.state.ledger.length, 0, 'no ledger row for a refused debit');
});

test('debitVault is idempotent on tx_ref', async () => {
  const db = makeFakeDb({ available: 1000 });
  await debitVault(db, { txRef: 'WD-SAME', amount: 400, source: 'B2C_PAYOUT' });
  await debitVault(db, { txRef: 'WD-SAME', amount: 400, source: 'B2C_PAYOUT' });
  assert.equal(db.state.vault.available, 600, 'debited once');
  assert.equal(db.state.ledger.length, 1);
});

// ─── reconcileDebit ─────────────────────────────────────────────────

test('reconcileDebit restores funds and clears pending after a failed payout', async () => {
  const db = makeFakeDb({ available: 3000, pending_payouts: 2000 });
  await reconcileDebit(db, { txRef: 'WD-FAIL', amount: 2000, reason: 'B2C rejected' });
  assert.equal(db.state.vault.available, 5000);
  assert.equal(db.state.vault.pending_payouts, 0);
  const reversal = db.state.ledger.find((r) => r.source === 'PAYOUT_REVERSAL');
  assert.ok(reversal, 'reversal ledger row recorded');
  assert.equal(reversal.amount, 2000);
});

// ─── Admin guard (fail-closed) ──────────────────────────────────────
// The guard reads process.env.ADMIN_SECRET lazily, so these tests flip the
// env var per case. A fake res captures the status + payload.

function fakeRes() {
  return {
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; },
    setHeader() {},
    end(payload) { if (payload) this.body = JSON.parse(payload); },
  };
}

function fakeReq(headers) {
  return { headers: headers || {}, method: 'GET', url: '/v1/admin/balance' };
}

test('admin routes 403 on a wrong secret', async (t) => {
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = 'correct-horse';
  t.after(() => { if (prev === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = prev; });
  const res = fakeRes();
  await settlement(fakeReq({ 'x-admin-secret': 'wrong' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test('admin routes 200 with the right secret (DB absent → 500, not 403)', async (t) => {
  const prev = process.env.ADMIN_SECRET;
  const prevDb = process.env.DATABASE_URL;
  process.env.ADMIN_SECRET = 'correct-horse';
  delete process.env.DATABASE_URL; // no DB in tests → handler reaches the DB check
  t.after(() => {
    if (prev === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = prev;
    if (prevDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDb;
  });
  const res = fakeRes();
  await settlement(fakeReq({ 'x-admin-secret': 'correct-horse' }), res);
  assert.equal(res.statusCode, 500, 'auth passed; failure is the missing DB');
  assert.match(res.body.message, /Database not configured/);
});

test('admin routes FAIL CLOSED (503) when ADMIN_SECRET is unset', async (t) => {
  const prev = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  t.after(() => { if (prev !== undefined) process.env.ADMIN_SECRET = prev; });
  // Even presenting the old committed default must be rejected.
  const res = fakeRes();
  await settlement(fakeReq({ 'x-admin-secret': 'glitchit-admin-2026' }), res);
  assert.equal(res.statusCode, 503, 'unset secret must refuse, not accept a default');
  assert.match(res.body.message, /not configured/);
});

// ─── formatPhone-shaped recipient guard ─────────────────────────────
// A withdrawal with no recipient and no WITHDRAW_PHONE must be refused
// rather than formatted into a bogus MSISDN like 25400000000.

test('withdraw refuses when no recipient phone is configured', async (t) => {
  const prevSec = process.env.ADMIN_SECRET;
  const prevPhone = process.env.WITHDRAW_PHONE;
  const prevDb = process.env.DATABASE_URL;
  const prevShortcode = process.env.DARAJA_SHORTCODE;
  process.env.ADMIN_SECRET = 'k';
  process.env.DARAJA_SHORTCODE = '174379'; // configured → reach the recipient check
  delete process.env.WITHDRAW_PHONE;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (prevSec === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = prevSec;
    if (prevPhone === undefined) delete process.env.WITHDRAW_PHONE; else process.env.WITHDRAW_PHONE = prevPhone;
    if (prevDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDb;
    if (prevShortcode === undefined) delete process.env.DARAJA_SHORTCODE; else process.env.DARAJA_SHORTCODE = prevShortcode;
  });

  const res = fakeRes();
  res.statusCode = 0;
  // Raw req stream for readBody — a one-shot JSON body.
  const { Readable } = require('node:stream');
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ amount: 100 }))]), {
    headers: { 'x-admin-secret': 'k' },
    method: 'POST',
    url: '/v1/admin/withdraw',
  });
  await settlement(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /recipient phone/i);
});
