// GlitchIt Pay — sends real STK push to user's phone
// If STK push fails, falls back to manual payment instructions.

const API_BASE = window.GLITCHIT_API_BASE || '';

function formatAmount(amount, currency = 'KES') {
  return `${currency} ${Number(amount).toLocaleString()}`;
}

function generateTxRef() {
  return `GLT-${Date.now().toString(36).slice(-6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}

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

// ─── Build the checkout UI ──────────────────────────────────────────
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'pg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="pg-sheet">

      <!-- STEP 1: Enter phone number -->
      <div id="pg-step-checkout">
        <div class="pg-header">
          <div class="pg-header-brand">
            <span style="font-size:22px;">⚡</span>
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
          <button type="button" class="pg-method-tab active" data-method="mpesa">
            <span class="pg-mt-icon">📱</span>M-Pesa
          </button>
          <button type="button" class="pg-method-tab" data-method="wallet" id="pg-wallet-tab" style="display:none;">
            <span class="pg-mt-icon">💰</span>Wallet
          </button>
        </div>
        <div class="pg-form" id="pg-form-mpesa">
          <div class="pg-field">
            <label for="pg-momo-number">Your M-Pesa phone number</label>
            <div class="pg-momo-field">
              <input type="text" id="pg-momo-code" class="pg-country-code" value="+254" maxlength="5" />
              <input type="text" id="pg-momo-number" placeholder="712 345 678" inputmode="tel" />
            </div>
          </div>
        </div>
        <div class="pg-form" id="pg-form-wallet" style="display:none;">
          <div class="pg-info-box" style="text-align:center;">
            <strong>Pay from GlitchIt Wallet</strong><br>
            Balance: <strong id="pg-wallet-bal">KES 0</strong>
          </div>
        </div>
        <button type="button" class="pg-pay-btn" id="pg-pay-btn">
          <span class="pg-pay-btn-text">Pay Now</span>
          <span class="pg-spinner"></span>
        </button>
        <div class="pg-security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secured by GlitchIt
        </div>
      </div>

      <!-- STEP 2a: STK Push sent — check your phone -->
      <div id="pg-step-stk" style="display:none;text-align:center;padding:40px 24px;">
        <div style="font-size:56px;margin-bottom:12px;animation:stkPulse 2s ease-in-out infinite;">📱</div>
        <h3 style="margin:0 0 8px;">Check Your Phone</h3>
        <p id="pg-stk-msg" style="font-size:14px;color:#ccc;margin:0 0 8px;">An M-Pesa prompt has been sent to your phone.</p>
        <p style="font-size:13px;color:#8e8e8e;margin:0 0 16px;">Enter your <strong>M-Pesa PIN</strong> on the prompt to pay.</p>
        <p class="pg-ref" id="pg-stk-ref" style="font-size:12px;color:#aaa;font-family:monospace;"></p>
        <div style="margin-top:16px;">
          <div class="pg-spinner" style="display:inline-block;margin:0 auto;"></div>
          <p style="font-size:12px;color:#8e8e8e;margin-top:8px;" id="pg-stk-status">Waiting for payment confirmation...</p>
        </div>
        <button type="button" class="pg-done-btn" id="pg-stk-cancel" style="margin-top:20px;background:#333;width:calc(100% - 48px);">Cancel</button>
      </div>

      <!-- STEP 2b: Manual payment instructions -->
      <div id="pg-step-instructions" style="display:none;text-align:center;padding:24px;">
        <div style="font-size:40px;margin-bottom:8px;">📱</div>
        <h3 style="margin:0 0 4px;">Pay via M-Pesa</h3>
        <p style="font-size:13px;color:#8e8e8e;margin:0 0 16px;">Follow these steps on your phone:</p>
        <div id="pg-inst-box" style="background:#1a1a2e;border-radius:12px;padding:16px;margin-bottom:16px;"></div>
        <div class="pg-field" style="text-align:left;margin-bottom:12px;">
          <label for="pg-mpesa-code" style="font-weight:700;">Enter M-Pesa confirmation code</label>
          <input type="text" id="pg-mpesa-code" placeholder="e.g. QHK71G4YS0" maxlength="14"
            style="text-transform:uppercase;letter-spacing:2px;font-size:20px;text-align:center;padding:16px;font-weight:700;" />
          <p style="font-size:11px;color:#8e8e8e;margin-top:4px;">This is the code you receive via SMS after paying</p>
        </div>
        <button type="button" class="pg-pay-btn" id="pg-submit-btn" style="margin-bottom:8px;">
          <span class="pg-pay-btn-text">Submit Code</span>
          <span class="pg-spinner"></span>
        </button>
        <button type="button" class="pg-done-btn" id="pg-inst-cancel" style="background:#333;width:calc(100% - 48px);margin:0 24px;">Cancel</button>
      </div>

      <!-- STEP 3: Success -->
      <div id="pg-step-success" style="display:none;text-align:center;padding:40px 24px;">
        <div class="pg-success-icon">✓</div>
        <h3>Payment Successful!</h3>
        <p id="pg-success-msg">Your payment has been confirmed.</p>
        <p class="pg-ref" id="pg-success-ref"></p>
        <button type="button" class="pg-done-btn" id="pg-done-btn">Done</button>
      </div>

      <!-- STEP 4: Error -->
      <div id="pg-step-error" style="display:none;text-align:center;padding:40px 24px;">
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
  overlay.querySelectorAll('.pg-method-tab').forEach((tab) => {
    tab.addEventListener('click', () => selectMethod(tab.dataset.method));
  });
  overlay.querySelector('#pg-pay-btn').addEventListener('click', handlePay);
  overlay.querySelector('#pg-submit-btn').addEventListener('click', handleSubmitCode);
  overlay.querySelector('#pg-done-btn').addEventListener('click', close);
  overlay.querySelector('#pg-retry-btn').addEventListener('click', showCheckout);
  overlay.querySelector('#pg-stk-cancel').addEventListener('click', close);
  overlay.querySelector('#pg-inst-cancel').addEventListener('click', close);
}

function selectMethod(method) {
  overlay.querySelectorAll('.pg-method-tab').forEach((t) => t.classList.remove('active'));
  overlay.querySelector(`[data-method="${method}"]`).classList.add('active');
  ['mpesa', 'wallet'].forEach((m) => {
    const form = overlay.querySelector(`#pg-form-${m}`);
    if (form) form.style.display = m === method ? '' : 'none';
  });
  overlay.querySelector('#pg-pay-btn .pg-pay-btn-text').textContent = method === 'wallet' ? 'Pay from Wallet' : 'Pay Now';
}

function fieldError(id, msg) {
  const el = overlay.querySelector(`#${id}`);
  if (el) { el.style.borderColor = '#ff3b30'; el.focus(); }
  toast('⚠', msg);
}

// ─── Handle "Pay Now" ───────────────────────────────────────────────
async function handlePay() {
  if (isProcessing) return;
  const method = overlay.querySelector('.pg-method-tab.active')?.dataset.method || 'mpesa';

  if (method === 'wallet') {
    const amount = currentOptions?.amount || 0;
    if (window.GlitchItWallet && window.GlitchItWallet.canAfford(amount)) {
      const txRef = currentOptions?.api_ref || generateTxRef();
      processWalletPayment(txRef);
      showSuccess({ ref: txRef, msg: 'Paid from wallet.' });
    } else {
      toast('⚠', 'Insufficient wallet balance');
    }
    return;
  }

  const phone = overlay.querySelector('#pg-momo-number')?.value.replace(/\s/g, '');
  if (!phone || phone.length < 9) return fieldError('pg-momo-number', 'Enter a valid phone number');

  isProcessing = true;
  const btn = overlay.querySelector('#pg-pay-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const code = overlay.querySelector('#pg-momo-code')?.value || '+254';
    const result = await apiPost('/api/payment', {
      amount: currentOptions?.amount || 0,
      phone: code + phone,
      title: currentOptions?.title || 'GlitchIt',
    });

    if (result.ok) {
      currentTxRef = result.tx_ref;

      if (result.status === 'stk_sent') {
        // STK push sent — show waiting state, poll for confirmation
        showStkWaiting(result);
      } else {
        // Manual instructions — show payment instructions + confirmation code input
        showInstructions(result);
      }
    } else {
      showError(result.error || 'Payment failed');
    }
  } catch (err) {
    showError('Check your connection and try again');
  } finally {
    isProcessing = false;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── STK Push sent — show waiting state ─────────────────────────────
function showStkWaiting(result) {
  showStep('pg-step-stk');
  overlay.querySelector('#pg-stk-msg').textContent = result.message || 'An M-Pesa prompt has been sent to your phone.';
  overlay.querySelector('#pg-stk-ref').textContent = `Ref: ${currentTxRef}`;
  overlay.querySelector('#pg-stk-status').textContent = 'Waiting for payment confirmation...';
  startPolling(currentTxRef);
}

// ─── Manual instructions ────────────────────────────────────────────
function showInstructions(result) {
  showStep('pg-step-instructions');
  const inst = result.instructions;
  if (!inst) return;

  const box = overlay.querySelector('#pg-inst-box');
  box.innerHTML = `
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-size:11px;color:#8e8e8e;">Pay to</div>
      <div style="font-size:26px;font-weight:900;color:#00e676;letter-spacing:2px;margin:4px 0;">${inst.mpesa_number}</div>
      <div style="font-size:12px;color:#8e8e8e;">${inst.business_name}</div>
    </div>
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-size:11px;color:#8e8e8e;">Amount</div>
      <div style="font-size:22px;font-weight:900;color:#fff;">KES ${Number(inst.amount).toLocaleString()}</div>
    </div>
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-size:11px;color:#8e8e8e;">Reference</div>
      <div style="font-size:16px;font-weight:700;color:#ffab00;letter-spacing:2px;">${inst.reference}</div>
      <button type="button" id="pg-copy-ref" style="margin-top:6px;background:#333;border:none;color:#00e676;padding:4px 14px;border-radius:6px;font-size:11px;cursor:pointer;">Copy</button>
    </div>
    <div style="text-align:left;padding:0 4px;">
      <ol style="margin:0;padding-left:18px;font-size:13px;line-height:2;color:#ccc;">
        ${inst.steps.map(s => `<li>${s}</li>`).join('')}
      </ol>
    </div>`;

  setTimeout(() => {
    const copyBtn = overlay.querySelector('#pg-copy-ref');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(inst.reference).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => {});
    });
  }, 100);
}

// ─── Handle confirmation code submission ────────────────────────────
async function handleSubmitCode() {
  if (isProcessing) return;
  const code = overlay.querySelector('#pg-mpesa-code')?.value.trim();
  if (!code) return fieldError('pg-mpesa-code', 'Enter your M-Pesa confirmation code');
  if (code.length < 8) return fieldError('pg-mpesa-code', 'Code should be 8-14 characters');

  isProcessing = true;
  const btn = overlay.querySelector('#pg-submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const result = await apiPost('/api/payment/submit', { tx_ref: currentTxRef, mpesa_code: code.toUpperCase() });
    if (result.ok) {
      showSuccess({ ref: currentTxRef, msg: 'Your confirmation code has been received and is being verified.' });
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

// ─── Poll for payment status (after STK push) ──────────────────────
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
        showSuccess({ ref: txRef, msg: `KES ${Number(result.amount).toLocaleString()} received! Receipt: ${result.receipt || 'N/A'}` });
      } else if (result.status === 'cancelled') {
        stopPolling();
        showError('Payment was cancelled.');
      } else if (result.status === 'failed') {
        stopPolling();
        showError(result.error || 'Payment failed');
      }
    } catch(e) {}
  }, 2000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  pollCount = 0;
}

// ─── Wallet payment ─────────────────────────────────────────────────
function processWalletPayment(txRef) {
  const amount = currentOptions?.amount || 0;
  const user = window.GLITCHIT_USER;
  if (!user?.id) return;
  const balKey = `glitchit.wallet.${user.id}`;
  const txnKey = `glitchit.txns.${user.id}`;
  const bal = Number(localStorage.getItem(balKey)) || 0;
  localStorage.setItem(balKey, String(Math.round((bal - amount) * 100) / 100));
  const txns = JSON.parse(localStorage.getItem(txnKey) || '[]');
  txns.unshift({ id: `txn-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, type: 'purchase', amount: -amount, note: `Payment: ${currentOptions?.title||'GlitchIt'}`, ref: txRef, status: 'completed', timestamp: Date.now() });
  localStorage.setItem(txnKey, JSON.stringify(txns.slice(0, 100)));
  document.dispatchEvent(new CustomEvent('wallet-purchase', { detail: { amount } }));
}

// ─── Step navigation ────────────────────────────────────────────────
function showStep(id) {
  ['pg-step-checkout','pg-step-stk','pg-step-instructions','pg-step-success','pg-step-error'].forEach((s) => {
    const el = overlay.querySelector(`#${s}`);
    if (el) el.style.display = s === id ? '' : 'none';
  });
}

function showSuccess(result) {
  showStep('pg-step-success');
  overlay.querySelector('#pg-success-ref').textContent = `Ref: ${result.ref}`;
  overlay.querySelector('#pg-success-msg').textContent = result.msg || 'Payment confirmed!';
  if (currentResolve) { currentResolve({ ok: true, ref: result.ref }); currentResolve = null; }
}

function showError(msg) {
  showStep('pg-step-error');
  overlay.querySelector('#pg-error-msg').textContent = msg;
}

function showCheckout() { showStep('pg-step-checkout'); }

// ─── Open/close ─────────────────────────────────────────────────────
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
    overlay.querySelector('#pg-merchant-name').textContent = opts.title || 'GlitchIt';
    overlay.querySelector('#pg-merchant-desc').textContent = opts.description || '';
    overlay.querySelector('#pg-currency-label').textContent = opts.currency || 'KES';
    overlay.querySelector('#pg-total-amount').textContent = formatAmount(amount, opts.currency || 'KES');

    const walletBal = window.GlitchItWallet ? window.GlitchItWallet.getBalance() : 0;
    const walletTab = overlay.querySelector('#pg-wallet-tab');
    const walletBalEl = overlay.querySelector('#pg-wallet-bal');
    if (walletTab) walletTab.style.display = walletBal >= amount ? '' : 'none';
    if (walletBalEl) walletBalEl.textContent = formatAmount(walletBal, 'KES');

    selectMethod('mpesa');
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
  if (currentReject && !isProcessing) { currentReject(new Error('payment closed')); currentReject = null; currentResolve = null; }
  setTimeout(() => {
    if (overlay) overlay.querySelectorAll('.pg-field input').forEach((el) => { el.value = ''; el.style.borderColor = ''; });
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
  link.href = `${API_BASE}/src/payment-checkout.css?v=7`;
  document.head.appendChild(link);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
} else { injectStyles(); }

export { checkout as glitchitCheckout, formatAmount, generateTxRef };

try {
  window.GlitchItPaymentGateway = { checkout, glitchitCheckout: checkout, formatAmount, generateTxRef };
} catch(e) {}
