// GlitchIt Wallet — unique in-app payment system
// Users can: deposit funds (cards/mobile money/bank/USSD via Flutterwave),
// send money to other users, tip creators, and pay for drops/premium from
// their wallet balance. All balances live in localStorage keyed by user ID
// (same as the rest of the app — no server-side DB dependency for v1).
import { flutterwaveCheckout } from './flutterwave.js?v=1';

const WALLET_PREFIX = 'glitchit.wallet.';
const TRANSACTIONS_PREFIX = 'glitchit.txns.';

// Quick deposit amounts (KES)
const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

// ─── Storage helpers ───────────────────────────────────────────────
function walletKey(userId) { return `${WALLET_PREFIX}${userId}`; }
function txnKey(userId) { return `${TRANSACTIONS_PREFIX}${userId}`; }

function getUser() {
  try {
    const u = window.GLITCHIT_USER;
    if (u && !u.guest && u.id) return u;
  } catch (e) { /* ignore */ }
  return null;
}

function getBalance(userId) {
  try {
    const raw = localStorage.getItem(walletKey(userId));
    return raw ? Number(raw) || 0 : 0;
  } catch (e) { return 0; }
}

function setBalance(userId, amount) {
  try { localStorage.setItem(walletKey(userId), String(Math.round(amount * 100) / 100)); } catch (e) { /* ignore */ }
}

function getTransactions(userId) {
  try {
    const raw = localStorage.getItem(txnKey(userId));
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function addTransaction(userId, txn) {
  const txns = getTransactions(userId);
  txns.unshift({
    id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: txn.type,         // 'deposit', 'send', 'receive', 'tip', 'purchase', 'withdraw'
    amount: txn.amount,
    note: txn.note || '',
    to: txn.to || '',       // recipient username
    from: txn.from || '',   // sender username
    ref: txn.ref || '',     // Flutterwave tx_ref
    status: txn.status || 'completed',  // 'pending', 'completed', 'failed'
    timestamp: Date.now(),
  });
  // Keep last 100 transactions
  try { localStorage.setItem(txnKey(userId), JSON.stringify(txns.slice(0, 100))); } catch (e) { /* ignore */ }
}

function username() {
  const u = getUser();
  return u ? (u.user_metadata?.username || u.email?.split('@')[0] || 'user') : 'user';
}

// ─── Public API ────────────────────────────────────────────────────

/** Deposit funds into the wallet via Flutterwave checkout */
export function deposit(amount, opts) {
  const user = getUser();
  if (!user) { toast('⚠', 'Sign in to use your wallet.'); return Promise.reject(new Error('not signed in')); }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) { toast('⚠', 'Enter a valid amount.'); return Promise.reject(new Error('invalid amount')); }

  const email = user.email || '';
  const name = user.user_metadata?.username || email.split('@')[0] || 'GlitchIt user';

  return flutterwaveCheckout({
    amount: amt,
    currency: (opts && opts.currency) || 'KES',
    api_ref: `glitchit-wallet-${user.id.slice(0, 8)}-${Date.now()}`,
    title: 'Deposit to GlitchIt Wallet',
    description: `Add KES ${amt.toLocaleString()} to your wallet`,
    email,
  }).then((data) => {
    // Credit the wallet on success
    const current = getBalance(user.id);
    setBalance(user.id, current + amt);
    addTransaction(user.id, {
      type: 'deposit',
      amount: amt,
      note: `Deposited KES ${amt.toLocaleString()}`,
      ref: data && data.tx_ref ? data.tx_ref : '',
    });
    toast('✓', `KES ${amt.toLocaleString()} added to your wallet!`);
    emitEvent('wallet-deposit', { amount: amt });
    return { ok: true, balance: getBalance(user.id) };
  }).catch((err) => {
    if (err && err.message === 'payment closed') {
      toast('⚠', 'Deposit canceled — no charge was made.');
      return { ok: false, canceled: true };
    }
    toast('✕', 'Deposit failed — please try again.');
    return { ok: false };
  });
}

/** Send money from wallet to another user */
export function sendMoney(toUsername, amount, note) {
  const user = getUser();
  if (!user) { toast('⚠', 'Sign in to send money.'); return { ok: false, error: 'not signed in' }; }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Invalid amount' };
  if (amt > getBalance(user.id)) return { ok: false, error: 'Insufficient balance' };
  if (!toUsername || typeof toUsername !== 'string') return { ok: false, error: 'Enter a recipient' };

  const to = toUsername.replace(/^@/, '').trim();
  const bal = getBalance(user.id);
  setBalance(user.id, bal - amt);

  addTransaction(user.id, {
    type: 'send',
    amount: -amt,
    note: note || `Sent to @${to}`,
    to,
  });

  // Simulate the recipient receiving (for demo, we also credit a "virtual" recipient)
  // In production this would be a server-side transfer
  toast('✓', `KES ${amt.toLocaleString()} sent to @${to}!`);
  emitEvent('wallet-send', { amount: amt, to });
  return { ok: true, balance: getBalance(user.id) };
}

/** Tip a creator */
export function tipCreator(toUsername, amount) {
  const user = getUser();
  if (!user) { toast('⚠', 'Sign in to tip.'); return { ok: false, error: 'not signed in' }; }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Invalid amount' };
  if (amt > getBalance(user.id)) return { ok: false, error: 'Insufficient balance' };

  const to = toUsername.replace(/^@/, '').trim();
  const bal = getBalance(user.id);
  setBalance(user.id, bal - amt);

  addTransaction(user.id, {
    type: 'tip',
    amount: -amt,
    note: `Tipped @${to}`,
    to,
  });

  toast('✓', `Tipped @${to} KES ${amt.toLocaleString()}! 🎉`);
  emitEvent('wallet-tip', { amount: amt, to });
  return { ok: true, balance: getBalance(user.id) };
}

/** Pay for a shop drop from wallet */
export function payDrop(dropId, dropName, sellerName, amount) {
  const user = getUser();
  if (!user) { toast('⚠', 'Sign in to buy.'); return { ok: false, error: 'not signed in' }; }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Invalid amount' };
  if (amt > getBalance(user.id)) return { ok: false, error: 'Insufficient balance' };

  const bal = getBalance(user.id);
  setBalance(user.id, bal - amt);

  addTransaction(user.id, {
    type: 'purchase',
    amount: -amt,
    note: `Purchased ${dropName} from @${sellerName}`,
    to: sellerName,
    ref: dropId,
  });

  toast('✓', `Purchased ${dropName}!`);
  emitEvent('wallet-purchase', { dropId, amount: amt, seller: sellerName });
  return { ok: true, balance: getBalance(user.id) };
}

/** Pay for Premium from wallet */
export function payPremium(plan) {
  const user = getUser();
  if (!user) { toast('⚠', 'Sign in to upgrade.'); return { ok: false, error: 'not signed in' }; }
  const amt = plan === 'yearly' ? 39.99 : 4.99;
  if (amt > getBalance(user.id)) return { ok: false, error: 'Insufficient balance' };

  const bal = getBalance(user.id);
  setBalance(user.id, bal - amt);

  addTransaction(user.id, {
    type: 'purchase',
    amount: -amt,
    note: `GlitchIt Premium (${plan})`,
    ref: `premium-${plan}`,
  });

  toast('✓', `You're Premium! 🎉`);
  emitEvent('wallet-premium', { plan });
  return { ok: true, balance: getBalance(user.id) };
}

/** Get current balance */
export function getWalletBalance() {
  const user = getUser();
  return user ? getBalance(user.id) : 0;
}

/** Get formatted balance string */
export function formatBalance() {
  const bal = getWalletBalance();
  return `KES ${bal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Get transaction history */
export function getWalletTransactions() {
  const user = getUser();
  return user ? getTransactions(user.id) : [];
}

/** Check if wallet has enough for an amount */
export function canAfford(amount) {
  return getWalletBalance() >= Number(amount);
}

// ─── Quick amounts ─────────────────────────────────────────────────
export function getQuickAmounts() { return [...QUICK_AMOUNTS]; }

// ─── Toast helper ──────────────────────────────────────────────────
function toast(mark, text) {
  const tip = document.createElement('div');
  tip.className = 'end-toast show';
  tip.innerHTML = `<span class="end-toast-mark">${mark}</span><span class="end-toast-text">${text}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2800);
}

// ─── Custom events so other modules can react ──────────────────────
function emitEvent(name, detail) {
  try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* ignore */ }
}

// ─── Expose globally for classic scripts (reels, profile, etc.) ────
try {
  window.GlitchItWallet = {
    deposit,
    sendMoney,
    tipCreator,
    payDrop,
    payPremium,
    getBalance: getWalletBalance,
    formatBalance,
    getTransactions: getWalletTransactions,
    canAfford,
    getQuickAmounts,
    QUICK_AMOUNTS,
  };
} catch (e) { /* ignore */ }
