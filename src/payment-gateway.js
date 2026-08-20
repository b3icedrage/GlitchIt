// GlitchIt Payment Gateway — custom payment system built from scratch
// Supports real M-Pesa STK push via Safaricom Daraja API.
// No third-party SDK dependencies.

const API_BASE = window.GLITCHIT_API_BASE || '';

// ─── Supported currencies ───────────────────────────────────────────
const CURRENCIES = {
  KES: { symbol: 'KES', name: 'Kenyan Shilling', decimals: 0 },
  USD: { symbol: 'USD', name: 'US Dollar', decimals: 2 },
};

// ─── Generate unique transaction reference ──────────────────────────
function generateTxRef(prefix = 'glt') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`.toUpperCase();
}

// ─── Format currency amount ─────────────────────────────────────────
function formatAmount(amount, currency = 'KES') {
  const config = CURRENCIES[currency] || CURRENCIES.KES;
  return `${config.symbol} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  })}`;
}

// ─── Validate card number (Luhn) ────────────────────────────────────
function isValidCard(number) {
  const digits = number.replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function detectCardBrand(number) {
  const d = number.replace(/\s/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  return '';
}

function isValidExpiry(expiry) {
  const m = expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const month = parseInt(m[1], 10);
  const year = parseInt('20' + m[2], 10);
  if (month < 1 || month > 12) return false;
  return new Date(year, month) > new Date();
}

// ─── API helpers ────────────────────────────────────────────────────
async function apiPost(endpoint, data) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ─── State ──────────────────────────────────────────────────────────
let overlay = null;
let currentOptions = null;
let currentResolve = null;
let currentReject = null;
let isProcessing = false;
let pollTimer = null;

// ─── Create checkout modal ──────────────────────────────────────────
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'pg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="pg-sheet">
      <div id="pg-step-checkout">
        <div class="pg-header">
          <h2>GlitchIt Pay</h2>
          <button type="button" class="pg-close" id="pg-close-btn" aria-label="Close">✕</button>
        </div>
        <div class="pg-merchant">
          <div class="pg-merchant-name" id="pg-merchant-name">GlitchIt</div>
          <div class="pg-merchant-desc" id="pg-merchant-desc"></div>
        </div>
        <div class="pg-amount-display">
          <div class="pg-currency" id="pg-currency-label">KES</div>
          <div class="pg-total" id="pg-total-amount">0</div>
        </div>

        <div class="pg-methods">
          <button type="button" class="pg-method-tab active" data-method="momo">
            <span class="pg-mt-icon">📱</span>M-Pesa
          </button>
          <button type="button" class="pg-method-tab" data-method="card">
            <span class="pg-mt-icon">💳</span>Card
          </button>
          <button type="button" class="pg-method-tab" data-method="wallet" id="pg-wallet-tab" style="display:none;">
            <span class="pg-mt-icon">💰</span>Wallet
          </button>
        </div>

        <!-- M-Pesa form (default) -->
        <div class="pg-form" id="pg-form-momo">
          <div class="pg-field">
            <label for="pg-momo-number">M-Pesa phone number</label>
            <div class="pg-momo-field">
              <input type="text" id="pg-momo-code" class="pg-country-code" value="+254" maxlength="5" />
              <input type="text" id="pg-momo-number" placeholder="712 345 678" inputmode="tel" autocomplete="tel" />
            </div>
          </div>
          <div class="pg-info-box">
            You'll receive an <strong>STK push</strong> on your phone. Enter your <strong>M-Pesa PIN</strong> to complete the payment.
          </div>
        </div>

        <!-- Card form -->
        <div class="pg-form" id="pg-form-card" style="display:none;">
          <div class="pg-field">
            <label for="pg-card-number">Card number</label>
            <input type="text" id="pg-card-number" placeholder="1234 5678 9012 3456" maxlength="19" inputmode="numeric" />
            <div id="pg-card-brand" style="font-size:11px;color:#8e8e8e;margin-top:2px;"></div>
          </div>
          <div class="pg-row">
            <div class="pg-field">
              <label for="pg-card-expiry">Expiry</label>
              <input type="text" id="pg-card-expiry" placeholder="MM/YY" maxlength="5" inputmode="numeric" />
            </div>
            <div class="pg-field">
              <label for="pg-card-cvv">CVV</label>
              <input type="text" id="pg-card-cvv" placeholder="123" maxlength="4" inputmode="numeric" />
            </div>
          </div>
          <div class="pg-field">
            <label for="pg-card-name">Cardholder name</label>
            <input type="text" id="pg-card-name" placeholder="Jane Doe" />
          </div>
        </div>

        <!-- Wallet -->
        <div class="pg-form" id="pg-form-wallet" style="display:none;">
          <div class="pg-info-box" style="text-align:center;">
            <strong>Pay from GlitchIt Wallet</strong><br><br>
            Balance: <strong id="pg-wallet-bal">KES 0</strong>
          </div>
        </div>

        <button type="button" class="pg-pay-btn" id="pg-pay-btn">
          <span class="pg-pay-btn-text">Pay with M-Pesa</span>
          <span class="pg-spinner"></span>
        </button>

        <div class="pg-security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secured by GlitchIt Payment Gateway
        </div>
      </div>

      <!-- STK Push waiting state -->
      <div class="pg-success" id="pg-step-stk" style="display:none;">
        <div class="pg-success-icon" style="background:linear-gradient(135deg,#00c853,#4caf50);">📱</div>
        <h3>Check Your Phone</h3>
        <p id="pg-stk-msg">An M-Pesa prompt has been sent to your phone.</p>
        <p style="font-size:13px;color:#8e8e8e;margin-top:8px;">Enter your M-Pesa PIN on the STK push to complete the payment.</p>
        <p class="pg-ref" id="pg-stk-ref"></p>
        <div style="margin-top:16px;">
          <div class="pg-spinner" style="display:inline-block;margin:0 auto;"></div>
          <p style="font-size:12px;color:#8e8e8e;margin-top:8px;" id="pg-stk-status">Waiting for payment confirmation...</p>
        </div>
        <button type="button" class="pg-done-btn" id="pg-stk-cancel" style="margin-top:16px;background:#ff3b30;">Cancel</button>
      </div>

      <!-- Success -->
      <div class="pg-success" id="pg-step-success" style="display:none;">
        <div class="pg-success-icon">✓</div>
        <h3>Payment Successful!</h3>
        <p id="pg-success-msg">Your payment has been confirmed.</p>
        <p class="pg-ref" id="pg-success-ref"></p>
        <button type="button" class="pg-done-btn" id="pg-done-btn">Done</button>
      </div>

      <!-- Error -->
      <div class="pg-error" id="pg-step-error" style="display:none;">
        <div class="pg-error-icon">✕</div>
        <h3>Payment Failed</h3>
        <p id="pg-error-msg">Something went wrong.</p>
        <button type="button" class="pg-retry-btn" id="pg-retry-btn">Try again</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  bindEvents();
  return overlay;
}

function bindEvents() {
  overlay.querySelector('#pg-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
  });

  overlay.querySelectorAll('.pg-method-tab').forEach((tab) => {
    tab.addEventListener('click', () => selectMethod(tab.dataset.method));
  });

  // Card formatting
  const cardInput = overlay.querySelector('#pg-card-number');
  if (cardInput) {
    cardInput.addEventListener('input', () => {
      let raw = cardInput.value.replace(/\D/g, '').slice(0, 16);
      cardInput.value = raw.replace(/(.{4})/g, '$1 ').trim();
      overlay.querySelector('#pg-card-brand').textContent = detectCardBrand(raw);
      cardInput.style.borderColor = '';
    });
  }

  const expiryInput = overlay.querySelector('#pg-card-expiry');
  if (expiryInput) {
    expiryInput.addEventListener('input', () => {
      let raw = expiryInput.value.replace(/\D/g, '').slice(0, 4);
      if (raw.length >= 2) raw = raw.slice(0, 2) + '/' + raw.slice(2);
      expiryInput.value = raw;
    });
  }

  overlay.querySelector('#pg-pay-btn').addEventListener('click', handlePay);
  overlay.querySelector('#pg-done-btn').addEventListener('click', close);
  overlay.querySelector('#pg-retry-btn').addEventListener('click', showCheckout);
  overlay.querySelector('#pg-stk-cancel').addEventListener('click', () => {
    stopPolling();
    showCheckout();
  });
}

function selectMethod(method) {
  overlay.querySelectorAll('.pg-method-tab').forEach((t) => t.classList.remove('active'));
  overlay.querySelector(`[data-method="${method}"]`).classList.add('active');

  ['momo', 'card', 'wallet'].forEach((m) => {
    const form = overlay.querySelector(`#pg-form-${m}`);
    if (form) form.style.display = m === method ? '' : 'none';
  });

  const labels = { momo: 'Pay with M-Pesa', card: 'Pay with card', wallet: 'Pay from Wallet' };
  overlay.querySelector('#pg-pay-btn .pg-pay-btn-text').textContent = labels[method] || 'Pay now';
}

function fieldError(id, msg) {
  const el = overlay.querySelector(`#${id}`);
  if (el) { el.style.borderColor = '#ff3b30'; el.focus(); }
  toast('⚠', msg);
}

// ─── Handle pay button click ────────────────────────────────────────
async function handlePay() {
  if (isProcessing) return;

  const method = overlay.querySelector('.pg-method-tab.active')?.dataset.method || 'momo';
  const txRef = currentOptions?.api_ref || generateTxRef();

  // Validate
  if (method === 'momo') {
    const phone = overlay.querySelector('#pg-momo-number')?.value.replace(/\s/g, '');
    if (!phone || phone.length < 9) return fieldError('pg-momo-number', 'Enter a valid phone number');
  } else if (method === 'card') {
    const num = overlay.querySelector('#pg-card-number').value.replace(/\s/g, '');
    const exp = overlay.querySelector('#pg-card-expiry').value;
    const cvv = overlay.querySelector('#pg-card-cvv').value;
    const name = overlay.querySelector('#pg-card-name').value.trim();
    if (!isValidCard(num)) return fieldError('pg-card-number', 'Enter a valid card number');
    if (!isValidExpiry(exp)) return fieldError('pg-card-expiry', 'Enter a valid expiry');
    if (!cvv || cvv.length < 3) return fieldError('pg-card-cvv', 'Enter CVV');
    if (!name) return fieldError('pg-card-name', 'Enter cardholder name');
  } else if (method === 'wallet') {
    const amount = currentOptions?.amount || 0;
    if (!window.GlitchItWallet || !window.GlitchItWallet.canAfford(amount)) {
      return toast('⚠', 'Insufficient wallet balance');
    }
  }

  isProcessing = true;
  const btn = overlay.querySelector('#pg-pay-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    let result;

    if (method === 'wallet') {
      result = processWalletPayment(txRef);
    } else {
      result = await processPayment({ method, txRef });
    }

    if (result.ok) {
      if (result.status === 'stk_sent') {
        // STK push sent — show waiting state and start polling
        showStkWaiting(result, txRef);
      } else {
        showSuccess(result);
      }
    } else {
      showError(result.error || 'Payment failed');
    }
  } catch (err) {
    showError(err.message || 'Payment failed');
  } finally {
    isProcessing = false;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── Process payment via server ─────────────────────────────────────
async function processPayment({ method, txRef }) {
  const amount = currentOptions?.amount || 0;
  const currency = currentOptions?.currency || 'KES';
  const user = window.GLITCHIT_USER;
  const email = user?.email || 'guest@glitchit.app';

  const payload = {
    amount,
    currency,
    email,
    tx_ref: txRef,
    method: method === 'momo' ? 'mpesa' : method,
    title: currentOptions?.title || 'GlitchIt',
    description: currentOptions?.description || '',
  };

  if (method === 'momo') {
    const code = overlay.querySelector('#pg-momo-code')?.value || '+254';
    const phone = overlay.querySelector('#pg-momo-number')?.value.replace(/\s/g, '');
    payload.phone = code + phone;
  } else if (method === 'card') {
    payload.card_number = overlay.querySelector('#pg-card-number').value.replace(/\s/g, '');
    payload.card_expiry = overlay.querySelector('#pg-card-expiry').value;
    payload.card_cvv = overlay.querySelector('#pg-card-cvv').value;
    payload.card_name = overlay.querySelector('#pg-card-name').value.trim();
  }

  try {
    return await apiPost('/api/payment', payload);
  } catch (err) {
    return { ok: false, error: 'Could not reach payment server' };
  }
}

// ─── Process wallet payment ─────────────────────────────────────────
function processWalletPayment(txRef) {
  const amount = currentOptions?.amount || 0;
  const user = window.GLITCHIT_USER;
  if (!user?.id) return { ok: false, error: 'Not signed in' };

  const balKey = `glitchit.wallet.${user.id}`;
  const txnKey = `glitchit.txns.${user.id}`;

  try {
    const bal = Number(localStorage.getItem(balKey)) || 0;
    if (bal < amount) return { ok: false, error: 'Insufficient wallet balance' };
    localStorage.setItem(balKey, String(Math.round((bal - amount) * 100) / 100));

    const txns = JSON.parse(localStorage.getItem(txnKey) || '[]');
    txns.unshift({
      id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'purchase', amount: -amount,
      note: `Payment: ${currentOptions?.title || 'GlitchIt'}`,
      ref: txRef, status: 'completed', timestamp: Date.now(),
    });
    localStorage.setItem(txnKey, JSON.stringify(txns.slice(0, 100)));
    document.dispatchEvent(new CustomEvent('wallet-purchase', { detail: { amount } }));
    return { ok: true, ref: txRef, status: 'completed' };
  } catch (e) {
    return { ok: false, error: 'Payment failed' };
  }
}

// ─── STK Push: show waiting state and poll for confirmation ─────────
function showStkWaiting(result, txRef) {
  showStep('pg-step-stk');
  overlay.querySelector('#pg-stk-msg').textContent =
    result.message || 'An M-Pesa prompt has been sent to your phone.';
  overlay.querySelector('#pg-stk-ref').textContent = `Ref: ${txRef}`;
  overlay.querySelector('#pg-stk-status').textContent = 'Waiting for payment confirmation...';

  // Start polling for payment status
  startPolling(txRef);
}

let pollCount = 0;
const MAX_POLLS = 60; // Poll for up to 2 minutes (every 2 seconds)

function startPolling(txRef) {
  stopPolling();
  pollCount = 0;

  pollTimer = setInterval(async () => {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      stopPolling();
      showError('Payment timed out. Please try again.');
      return;
    }

    try {
      const result = await apiPost('/api/payment/verify', { tx_ref: txRef });
      if (result.ok && result.status === 'successful') {
        stopPolling();
        showSuccess({ ok: true, ref: txRef, status: 'successful' });
      } else if (result.error === 'Payment was cancelled by the user') {
        stopPolling();
        showError('Payment was cancelled.');
      } else if (!result.pending) {
        stopPolling();
        showError(result.error || 'Payment failed');
      }
      // If pending, keep polling
    } catch (err) {
      // Network error — keep polling
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollCount = 0;
}

// ─── Step navigation ────────────────────────────────────────────────
function showStep(id) {
  ['pg-step-checkout', 'pg-step-stk', 'pg-step-success', 'pg-step-error'].forEach((stepId) => {
    const el = overlay.querySelector(`#${stepId}`);
    if (el) el.style.display = stepId === id ? '' : 'none';
  });
}

function showSuccess(result) {
  showStep('pg-step-success');
  overlay.querySelector('#pg-success-ref').textContent = `Ref: ${result.ref}`;
  if (currentResolve) {
    currentResolve({ ok: true, ref: result.ref, status: result.status });
    currentResolve = null;
  }
}

function showError(msg) {
  showStep('pg-step-error');
  overlay.querySelector('#pg-error-msg').textContent = msg;
}

function showCheckout() {
  showStep('pg-step-checkout');
}

// ─── Open/close gateway ─────────────────────────────────────────────
export function checkout(opts) {
  return new Promise((resolve, reject) => {
    currentOptions = opts || {};
    currentResolve = resolve;
    currentReject = reject;
    isProcessing = false;
    stopPolling();

    ensureOverlay();
    showCheckout();

    const amount = Number(opts.amount) || 0;
    const currency = opts.currency || 'KES';

    overlay.querySelector('#pg-merchant-name').textContent = opts.title || 'GlitchIt';
    overlay.querySelector('#pg-merchant-desc').textContent = opts.description || '';
    overlay.querySelector('#pg-currency-label').textContent = currency;
    overlay.querySelector('#pg-total-amount').textContent = formatAmount(amount, currency);

    // Wallet
    const walletBal = window.GlitchItWallet ? window.GlitchItWallet.getBalance() : 0;
    const walletTab = overlay.querySelector('#pg-wallet-tab');
    const walletBalEl = overlay.querySelector('#pg-wallet-bal');
    if (walletTab) walletTab.style.display = walletBal >= amount ? '' : 'none';
    if (walletBalEl) walletBalEl.textContent = formatAmount(walletBal, 'KES');

    // Default to M-Pesa
    selectMethod('momo');

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => overlay.querySelector('#pg-momo-number')?.focus(), 300);
  });
}

function close() {
  if (!overlay) return;
  stopPolling();
  overlay.classList.remove('open');
  document.body.style.overflow = '';

  if (currentReject && !isProcessing) {
    currentReject(new Error('payment closed'));
    currentReject = null;
    currentResolve = null;
  }

  setTimeout(() => {
    if (overlay) {
      overlay.querySelectorAll('.pg-field input').forEach((el) => {
        el.value = '';
        el.style.borderColor = '';
      });
    }
  }, 300);
}

function toast(mark, text) {
  const tip = document.createElement('div');
  tip.className = 'end-toast show';
  tip.innerHTML = `<span class="end-toast-mark">${mark}</span><span class="end-toast-text">${text}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2800);
}

function injectStyles() {
  if (document.querySelector('link[href*="payment-checkout.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${API_BASE}/src/payment-checkout.css?v=3`;
  document.head.appendChild(link);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
} else {
  injectStyles();
}

export { checkout as glitchitCheckout, formatAmount, generateTxRef, detectCardBrand };

try {
  window.GlitchItPaymentGateway = {
    checkout, glitchitCheckout: checkout,
    formatAmount, generateTxRef, detectCardBrand,
  };
} catch (e) { /* ignore */ }
