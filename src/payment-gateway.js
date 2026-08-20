// GlitchIt Payment Gateway — real STK push via Safaricom Daraja API
// Built from scratch. No third-party payment SDK.
//
// Flow: User enters phone → STK push sent to phone → User enters PIN → Payment confirmed

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

// ─── API helpers ────────────────────────────────────────────────────
async function apiPost(endpoint, data) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`);
  return res.json();
}

// ─── State ──────────────────────────────────────────────────────────
let overlay = null;
let currentOptions = null;
let currentResolve = null;
let currentReject = null;
let isProcessing = false;
let pollTimer = null;
let currentTxRef = null;

// ─── Create checkout modal ──────────────────────────────────────────
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'pg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="pg-sheet">
      <!-- Step 1: Enter phone number -->
      <div id="pg-step-checkout">
        <div class="pg-header">
          <div class="pg-header-brand">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#00e676" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            <h2>GlitchIt Pay</h2>
          </div>
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
          <button type="button" class="pg-method-tab" data-method="wallet" id="pg-wallet-tab" style="display:none;">
            <span class="pg-mt-icon">💰</span>Wallet
          </button>
        </div>

        <!-- M-Pesa form -->
        <div class="pg-form" id="pg-form-momo">
          <div class="pg-field">
            <label for="pg-momo-number">M-Pesa phone number</label>
            <div class="pg-momo-field">
              <input type="text" id="pg-momo-code" class="pg-country-code" value="+254" maxlength="5" />
              <input type="text" id="pg-momo-number" placeholder="712 345 678" inputmode="tel" autocomplete="tel" />
            </div>
          </div>
          <div class="pg-info-box" id="pg-mode-info" style="display:none;">
            <span style="color:#ffab00;">⚡</span> <span id="pg-mode-text"></span>
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
          <span class="pg-pay-btn-text">Pay Now</span>
          <span class="pg-spinner"></span>
        </button>

        <div class="pg-security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secured by GlitchIt Payment Gateway
        </div>
      </div>

      <!-- Step 2: STK Push sent — check your phone -->
      <div class="pg-success" id="pg-step-stk" style="display:none;">
        <div class="pg-success-icon stk-pulse" style="background:linear-gradient(135deg,#00c853,#4caf50);">📱</div>
        <h3>Check Your Phone</h3>
        <p id="pg-stk-msg">An M-Pesa prompt has been sent to your phone.</p>
        <p style="font-size:13px;color:#8e8e8e;margin-top:4px;">Enter your <strong>M-Pesa PIN</strong> on the prompt to complete the payment.</p>
        <p class="pg-ref" id="pg-stk-ref"></p>
        <div style="margin-top:16px;">
          <div class="pg-spinner" style="display:inline-block;margin:0 auto;"></div>
          <p style="font-size:12px;color:#8e8e8e;margin-top:8px;" id="pg-stk-status">Waiting for payment confirmation...</p>
        </div>
        <button type="button" class="pg-done-btn" id="pg-stk-cancel" style="margin-top:16px;background:#333;">Cancel</button>
      </div>

      <!-- Step 3: Demo mode — enter confirmation code -->
      <div class="pg-success" id="pg-step-demo" style="display:none;">
        <div class="pg-success-icon" style="background:linear-gradient(135deg,#ff9800,#f57c00);">🧪</div>
        <h3>Demo Mode</h3>
        <p style="font-size:13px;color:#8e8e8e;">Daraja credentials not configured yet. Enter a test M-Pesa code to simulate payment.</p>
        <div class="pg-field" style="margin-top:16px;">
          <label for="pg-demo-code">M-Pesa confirmation code</label>
          <input type="text" id="pg-demo-code" placeholder="e.g. SHJ3K4ABCD" maxlength="14" style="text-transform:uppercase;letter-spacing:1px;font-size:18px;text-align:center;padding:14px;" />
        </div>
        <button type="button" class="pg-pay-btn" id="pg-demo-submit">
          <span class="pg-pay-btn-text">Submit Code</span>
          <span class="pg-spinner"></span>
        </button>
        <button type="button" class="pg-done-btn" id="pg-demo-cancel" style="margin-top:8px;background:#333;">Cancel</button>
      </div>

      <!-- Step 4: Success -->
      <div class="pg-success" id="pg-step-success" style="display:none;">
        <div class="pg-success-icon">✓</div>
        <h3>Payment Successful!</h3>
        <p id="pg-success-msg">Your payment has been confirmed.</p>
        <p class="pg-ref" id="pg-success-ref"></p>
        <button type="button" class="pg-done-btn" id="pg-done-btn">Done</button>
      </div>

      <!-- Step 5: Error -->
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

  overlay.querySelector('#pg-pay-btn').addEventListener('click', handlePay);
  overlay.querySelector('#pg-done-btn').addEventListener('click', close);
  overlay.querySelector('#pg-retry-btn').addEventListener('click', showCheckout);
  overlay.querySelector('#pg-stk-cancel').addEventListener('click', () => {
    stopPolling();
    close();
  });
  overlay.querySelector('#pg-demo-submit').addEventListener('click', handleDemoSubmit);
  overlay.querySelector('#pg-demo-cancel').addEventListener('click', () => {
    stopPolling();
    close();
  });
}

function selectMethod(method) {
  overlay.querySelectorAll('.pg-method-tab').forEach((t) => t.classList.remove('active'));
  overlay.querySelector(`[data-method="${method}"]`).classList.add('active');

  ['momo', 'wallet'].forEach((m) => {
    const form = overlay.querySelector(`#pg-form-${m}`);
    if (form) form.style.display = m === method ? '' : 'none';
  });

  const labels = { momo: 'Pay Now', wallet: 'Pay from Wallet' };
  overlay.querySelector('#pg-pay-btn .pg-pay-btn-text').textContent = labels[method] || 'Pay Now';
}

function fieldError(id, msg) {
  const el = overlay.querySelector(`#${id}`);
  if (el) { el.style.borderColor = '#ff3b30'; el.focus(); }
  toast('⚠', msg);
}

// ─── Handle "Pay Now" — send STK push or start wallet payment ───────
async function handlePay() {
  if (isProcessing) return;

  const method = overlay.querySelector('.pg-method-tab.active')?.dataset.method || 'momo';
  const txRef = currentOptions?.api_ref || generateTxRef();

  if (method === 'momo') {
    const phone = overlay.querySelector('#pg-momo-number')?.value.replace(/\s/g, '');
    if (!phone || phone.length < 9) return fieldError('pg-momo-number', 'Enter a valid phone number');
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
    if (method === 'wallet') {
      const result = processWalletPayment(txRef);
      if (result.ok) {
        showSuccess({ ok: true, ref: txRef, status: 'completed' });
      } else {
        showError(result.error || 'Wallet payment failed');
      }
    } else {
      // Get phone number
      const code = overlay.querySelector('#pg-momo-code')?.value || '+254';
      const phone = overlay.querySelector('#pg-momo-number')?.value.replace(/\s/g, '');
      const fullPhone = code + phone;

      // Call server to send STK push
      const result = await apiPost('/api/payment', {
        amount: currentOptions?.amount || 0,
        currency: currentOptions?.currency || 'KES',
        phone: fullPhone,
        tx_ref: txRef,
        title: currentOptions?.title || 'GlitchIt',
        description: currentOptions?.description || '',
        email: window.GLITCHIT_USER?.email || '',
      });

      if (result.ok) {
        currentTxRef = result.tx_ref;

        if (result.mode === 'demo') {
          // Demo mode — show confirmation code input
          showDemoMode(result);
        } else {
          // Live mode — STK push sent, show waiting state
          showStkWaiting(result);
        }
      } else {
        showError(result.error || 'Could not start payment');
      }
    }
  } catch (err) {
    showError(err.message || 'Payment failed — check your connection');
  } finally {
    isProcessing = false;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── Show STK Push waiting state (live mode) ───────────────────────
function showStkWaiting(result) {
  showStep('pg-step-stk');
  overlay.querySelector('#pg-stk-msg').textContent =
    result.message || 'An M-Pesa prompt has been sent to your phone.';
  overlay.querySelector('#pg-stk-ref').textContent = `Ref: ${result.tx_ref}`;
  overlay.querySelector('#pg-stk-status').textContent = 'Waiting for payment confirmation...';
  startPolling(result.tx_ref);
}

// ─── Show demo mode (no Daraja credentials) ────────────────────────
function showDemoMode(result) {
  showStep('pg-step-demo');
}

async function handleDemoSubmit() {
  if (isProcessing) return;

  const code = overlay.querySelector('#pg-demo-code')?.value.trim();
  if (!code || code.length < 8) return fieldError('pg-demo-code', 'Enter a valid code (8-14 characters)');

  isProcessing = true;
  const btn = overlay.querySelector('#pg-demo-submit');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const result = await apiPost('/api/payment/submit', {
      tx_ref: currentTxRef,
      mpesa_code: code.toUpperCase(),
    });

    if (result.ok) {
      showStep('pg-step-stk');
      overlay.querySelector('#pg-stk-msg').textContent = 'Code submitted. Verifying...';
      overlay.querySelector('#pg-stk-ref').textContent = `Ref: ${currentTxRef}`;
      overlay.querySelector('#pg-stk-status').textContent = 'Waiting for verification...';
      startPolling(currentTxRef);
    } else {
      showError(result.error || 'Failed to submit code');
    }
  } catch (err) {
    showError('Could not reach server');
  } finally {
    isProcessing = false;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── Poll for payment status ────────────────────────────────────────
let pollCount = 0;
const MAX_POLLS = 90;

function startPolling(txRef) {
  stopPolling();
  pollCount = 0;

  pollTimer = setInterval(async () => {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      stopPolling();
      showError('Payment timed out. If you completed the payment, it may still be processing.');
      return;
    }

    try {
      const result = await apiGet(`/api/payment/verify?tx_ref=${txRef}`);
      if (result.ok && result.status === 'verified') {
        stopPolling();
        showSuccess({ ok: true, ref: txRef, status: 'verified', amount: result.amount });
      } else if (result.status === 'cancelled') {
        stopPolling();
        showError('Payment was cancelled.');
      } else if (result.status === 'failed') {
        stopPolling();
        showError(result.error || 'Payment failed');
      }
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

// ─── Step navigation ────────────────────────────────────────────────
function showStep(id) {
  ['pg-step-checkout', 'pg-step-stk', 'pg-step-demo', 'pg-step-success', 'pg-step-error'].forEach((stepId) => {
    const el = overlay.querySelector(`#${stepId}`);
    if (el) el.style.display = stepId === id ? '' : 'none';
  });
}

function showSuccess(result) {
  showStep('pg-step-success');
  overlay.querySelector('#pg-success-ref').textContent = `Ref: ${result.ref}`;
  if (result.amount) {
    overlay.querySelector('#pg-success-msg').textContent = `KES ${Number(result.amount).toLocaleString()} has been received.`;
  }
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
    currentTxRef = null;
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

    // Check mode
    apiGet('/api/payment/config').then((cfg) => {
      const modeInfo = overlay.querySelector('#pg-mode-info');
      const modeText = overlay.querySelector('#pg-mode-text');
      if (cfg.mode === 'demo') {
        modeInfo.style.display = '';
        modeText.textContent = 'Demo mode — configure Daraja credentials for real STK push';
      } else {
        modeInfo.style.display = 'none';
      }
    }).catch(() => {});

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
  link.href = `${API_BASE}/src/payment-checkout.css?v=5`;
  document.head.appendChild(link);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
} else {
  injectStyles();
}

export { checkout as glitchitCheckout, formatAmount, generateTxRef };

try {
  window.GlitchItPaymentGateway = {
    checkout, glitchitCheckout: checkout,
    formatAmount, generateTxRef,
  };
} catch (e) { /* ignore */ }
