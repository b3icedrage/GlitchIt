// GlitchIt Payment Gateway — custom payment system built from scratch
// Users pay via M-Pesa (Lipa na M-Pesa) and enter confirmation codes.
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
      <!-- Step 1: Payment form -->
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
          <button type="button" class="pg-method-tab" data-method="wallet" id="pg-wallet-tab" style="display:none;">
            <span class="pg-mt-icon">💰</span>Wallet
          </button>
        </div>

        <!-- M-Pesa form (default) -->
        <div class="pg-form" id="pg-form-momo">
          <div class="pg-field">
            <label for="pg-momo-number">Your M-Pesa phone number</label>
            <div class="pg-momo-field">
              <input type="text" id="pg-momo-code" class="pg-country-code" value="+254" maxlength="5" />
              <input type="text" id="pg-momo-number" placeholder="712 345 678" inputmode="tel" autocomplete="tel" />
            </div>
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
          <span class="pg-pay-btn-text">Continue</span>
          <span class="pg-spinner"></span>
        </button>

        <div class="pg-security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secured by GlitchIt Payment Gateway
        </div>
      </div>

      <!-- Step 2: M-Pesa payment instructions -->
      <div class="pg-success" id="pg-step-instructions" style="display:none;">
        <div class="pg-success-icon" style="background:linear-gradient(135deg,#00c853,#4caf50);">📱</div>
        <h3>Pay via M-Pesa</h3>
        <p style="font-size:13px;color:#8e8e8e;margin-top:4px;">Follow these steps on your phone:</p>

        <div class="pg-info-box" id="pg-instruction-steps" style="text-align:left;margin-top:12px;font-size:14px;line-height:1.8;"></div>

        <div style="margin-top:16px;">
          <p class="pg-ref" id="pg-inst-ref"></p>
        </div>

        <div class="pg-field" style="margin-top:20px;">
          <label for="pg-mpesa-code">Enter M-Pesa confirmation code</label>
          <input type="text" id="pg-mpesa-code" placeholder="e.g. SHJ3K4ABCD" maxlength="14" style="text-transform:uppercase;letter-spacing:1px;font-size:18px;text-align:center;padding:14px;" />
          <p style="font-size:11px;color:#8e8e8e;margin-top:4px;">You'll receive this code via SMS after paying</p>
        </div>

        <button type="button" class="pg-pay-btn" id="pg-submit-code-btn">
          <span class="pg-pay-btn-text">Submit Confirmation Code</span>
          <span class="pg-spinner"></span>
        </button>

        <button type="button" class="pg-done-btn" id="pg-inst-cancel" style="margin-top:8px;background:#333;">Cancel</button>
      </div>

      <!-- Step 3: Waiting for verification -->
      <div class="pg-success" id="pg-step-waiting" style="display:none;">
        <div class="pg-success-icon" style="background:linear-gradient(135deg,#ff9800,#f57c00);">⏳</div>
        <h3>Verifying Payment</h3>
        <p id="pg-waiting-msg">Your confirmation code has been submitted. We're verifying your payment.</p>
        <p class="pg-ref" id="pg-waiting-ref"></p>
        <div style="margin-top:16px;">
          <div class="pg-spinner" style="display:inline-block;margin:0 auto;"></div>
          <p style="font-size:12px;color:#8e8e8e;margin-top:8px;" id="pg-waiting-status">This usually takes a few seconds...</p>
        </div>
        <button type="button" class="pg-done-btn" id="pg-waiting-cancel" style="margin-top:16px;background:#ff3b30;">Cancel</button>
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

  overlay.querySelector('#pg-pay-btn').addEventListener('click', handleContinue);
  overlay.querySelector('#pg-submit-code-btn').addEventListener('click', handleSubmitCode);
  overlay.querySelector('#pg-done-btn').addEventListener('click', close);
  overlay.querySelector('#pg-retry-btn').addEventListener('click', showCheckout);
  overlay.querySelector('#pg-inst-cancel').addEventListener('click', () => {
    stopPolling();
    close();
  });
  overlay.querySelector('#pg-waiting-cancel').addEventListener('click', () => {
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

  const labels = { momo: 'Continue', wallet: 'Pay from Wallet' };
  overlay.querySelector('#pg-pay-btn .pg-pay-btn-text').textContent = labels[method] || 'Continue';
}

function fieldError(id, msg) {
  const el = overlay.querySelector(`#${id}`);
  if (el) { el.style.borderColor = '#ff3b30'; el.focus(); }
  toast('⚠', msg);
}

// ─── Handle "Continue" button — initialize payment ──────────────────
async function handleContinue() {
  if (isProcessing) return;

  const method = overlay.querySelector('.pg-method-tab.active')?.dataset.method || 'momo';
  const txRef = currentOptions?.api_ref || generateTxRef();

  // Validate phone for M-Pesa
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
      // Initialize payment with server
      const user = window.GLITCHIT_USER;
      const payload = {
        amount: currentOptions?.amount || 0,
        currency: currentOptions?.currency || 'KES',
        email: user?.email || '',
        tx_ref: txRef,
        title: currentOptions?.title || 'GlitchIt',
        description: currentOptions?.description || '',
      };

      const result = await apiPost('/api/payment', payload);

      if (result.ok) {
        currentTxRef = result.tx_ref;
        showPaymentInstructions(result);
      } else {
        showError(result.error || 'Could not initialize payment');
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

// ─── Show M-Pesa payment instructions ───────────────────────────────
function showPaymentInstructions(result) {
  showStep('pg-step-instructions');

  const inst = result.instructions;
  if (inst) {
    // Show M-Pesa number prominently
    const stepsHtml = `
      <div style="background:#1a1a2e;border-radius:8px;padding:12px;margin-bottom:12px;text-align:center;">
        <div style="font-size:11px;color:#8e8e8e;">Pay to</div>
        <div style="font-size:22px;font-weight:700;color:#00e676;letter-spacing:1px;">${inst.mpesa_number}</div>
        <div style="font-size:12px;color:#8e8e8e;">${inst.business_name || 'GlitchIt'}</div>
      </div>
      <div style="background:#1a1a2e;border-radius:8px;padding:12px;margin-bottom:12px;text-align:center;">
        <div style="font-size:11px;color:#8e8e8e;">Amount</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">${inst.currency} ${Number(inst.amount).toLocaleString()}</div>
      </div>
      <div style="background:#1a1a2e;border-radius:8px;padding:12px;margin-bottom:12px;text-align:center;">
        <div style="font-size:11px;color:#8e8e8e;">Reference</div>
        <div style="font-size:16px;font-weight:700;color:#ffab00;letter-spacing:2px;">${inst.reference}</div>
        <button type="button" id="pg-copy-ref" style="margin-top:6px;background:#333;border:none;color:#00e676;padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;">Copy</button>
      </div>
      <div style="text-align:left;padding:0 4px;">
        <ol style="margin:0;padding-left:20px;font-size:13px;line-height:2;color:#ccc;">
          ${inst.steps.map(s => `<li>${s}</li>`).join('')}
        </ol>
      </div>`;

    overlay.querySelector('#pg-instruction-steps').innerHTML = stepsHtml;
    overlay.querySelector('#pg-inst-ref').textContent = `Ref: ${inst.reference}`;

    // Copy reference button
    setTimeout(() => {
      const copyBtn = overlay.querySelector('#pg-copy-ref');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(inst.reference).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = inst.reference;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          });
        });
      }
    }, 100);
  }
}

// ─── Handle "Submit Confirmation Code" button ───────────────────────
async function handleSubmitCode() {
  if (isProcessing) return;

  const code = overlay.querySelector('#pg-mpesa-code')?.value.trim();
  if (!code) return fieldError('pg-mpesa-code', 'Enter your M-Pesa confirmation code');
  if (code.length < 8) return fieldError('pg-mpesa-code', 'Code should be 8-14 characters');

  isProcessing = true;
  const btn = overlay.querySelector('#pg-submit-code-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const result = await apiPost('/api/payment/submit', {
      tx_ref: currentTxRef,
      mpesa_code: code.toUpperCase(),
    });

    if (result.ok) {
      showWaitingForVerification();
    } else {
      showError(result.error || 'Failed to submit code');
    }
  } catch (err) {
    showError('Could not reach server — try again');
  } finally {
    isProcessing = false;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── Show waiting for verification ──────────────────────────────────
function showWaitingForVerification() {
  showStep('pg-step-waiting');
  overlay.querySelector('#pg-waiting-ref').textContent = `Ref: ${currentTxRef}`;
  overlay.querySelector('#pg-waiting-status').textContent = 'This usually takes a few seconds...';
  startPolling(currentTxRef);
}

// ─── Poll for payment status ────────────────────────────────────────
let pollCount = 0;
const MAX_POLLS = 90; // Poll for up to 3 minutes (every 2 seconds)

function startPolling(txRef) {
  stopPolling();
  pollCount = 0;

  pollTimer = setInterval(async () => {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      stopPolling();
      showError('Verification timed out. Your payment may still be processing — check back later.');
      return;
    }

    try {
      const result = await apiGet(`/api/payment/verify?tx_ref=${txRef}`);
      if (result.ok && result.status === 'verified') {
        stopPolling();
        showSuccess({ ok: true, ref: txRef, status: 'verified', amount: result.amount });
      } else if (result.status === 'rejected') {
        stopPolling();
        showError(result.error || 'Payment could not be verified. Please contact support.');
      }
      // If pending or submitted, keep polling
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
  ['pg-step-checkout', 'pg-step-instructions', 'pg-step-waiting', 'pg-step-success', 'pg-step-error'].forEach((stepId) => {
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
  link.href = `${API_BASE}/src/payment-checkout.css?v=4`;
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
