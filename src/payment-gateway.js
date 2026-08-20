// GlitchIt Pay — PesaPal-powered payment gateway
// All payments go through PesaPal's hosted payment page.

const API_BASE = window.GLITCHIT_API_BASE || '';
const PESAPAL_MONTHLY_URL = 'https://store.pesapal.com/monthlypayment';

function formatAmount(amount, currency = 'KES') {
  return `${currency} ${Number(amount).toLocaleString()}`;
}

function generateTxRef() {
  return `GLT-${Date.now().toString(36).slice(-6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}

// ─── State ──────────────────────────────────────────────────────────
let overlay = null;
let currentOptions = null;
let currentResolve = null;
let currentReject = null;
let isProcessing = false;

// ─── Build the checkout overlay with PesaPal iframe ─────────────────
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'pg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="pg-sheet pg-sheet-pesapal">
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

      <!-- Wallet payment option (if user has enough balance) -->
      <div class="pg-form" id="pg-form-wallet" style="display:none;">
        <div class="pg-methods">
          <button type="button" class="pg-method-tab active" data-method="wallet">
            <span class="pg-mt-icon">💰</span>Pay from Wallet
          </button>
          <button type="button" class="pg-method-tab" data-method="pesapal">
            <span class="pg-mt-icon">📱</span>M-Pesa / Card
          </button>
        </div>
        <div class="pg-info-box" style="text-align:center;">
          <strong>Pay from GlitchIt Wallet</strong><br>
          Balance: <strong id="pg-wallet-bal">KES 0</strong>
        </div>
        <button type="button" class="pg-pay-btn" id="pg-pay-btn">
          <span class="pg-pay-btn-text">Pay from Wallet</span>
        </button>
      </div>

      <!-- PesaPal embed area -->
      <div class="pg-pesapal-area" id="pg-pesapal-area">
        <div class="pg-pesapal-loading">
          <div class="pg-spinner" style="display:inline-block;"></div>
          <p style="font-size:13px;color:#8e8e8e;margin-top:8px;">Loading PesaPal payment…</p>
        </div>
        <iframe
          id="pg-pesapal-frame"
          class="pg-pesapal-iframe"
          src=""
          frameborder="0"
          allowfullscreen
          style="display:none;"
          onload="this.style.display='block'; this.previousElementSibling.style.display='none';"
        ></iframe>
      </div>

      <!-- Success state -->
      <div id="pg-step-success" style="display:none;text-align:center;padding:40px 24px;">
        <div class="pg-success-icon">✓</div>
        <h3>Payment Successful!</h3>
        <p id="pg-success-msg">Your payment has been confirmed.</p>
        <p class="pg-ref" id="pg-success-ref"></p>
        <button type="button" class="pg-done-btn" id="pg-done-btn">Done</button>
      </div>

      <!-- Error state -->
      <div id="pg-step-error" style="display:none;text-align:center;padding:40px 24px;">
        <div class="pg-error-icon">✕</div>
        <h3>Payment Failed</h3>
        <p id="pg-error-msg">Something went wrong.</p>
        <button type="button" class="pg-retry-btn" id="pg-retry-btn">Try again</button>
      </div>

      <div class="pg-security">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        Secured by PesaPal
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

  // Wallet tab switching
  overlay.querySelectorAll('.pg-method-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.pg-method-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const method = tab.dataset.method;
      const walletForm = overlay.querySelector('#pg-form-wallet');
      const pesapalArea = overlay.querySelector('#pg-pesapal-area');
      if (method === 'wallet') {
        walletForm.querySelector('.pg-info-box').style.display = '';
        pesapalArea.style.display = 'none';
      } else {
        walletForm.querySelector('.pg-info-box').style.display = 'none';
        pesapalArea.style.display = '';
        loadPesaPalFrame();
      }
    });
  });

  // Wallet pay button
  const payBtn = overlay.querySelector('#pg-pay-btn');
  if (payBtn) payBtn.addEventListener('click', handleWalletPay);

  // Done / Retry
  const doneBtn = overlay.querySelector('#pg-done-btn');
  if (doneBtn) doneBtn.addEventListener('click', close);
  const retryBtn = overlay.querySelector('#pg-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', showCheckout);
}

function loadPesaPalFrame() {
  const frame = overlay.querySelector('#pg-pesapal-frame');
  const loading = overlay.querySelector('.pg-pesapal-loading');
  if (frame && !frame.src) {
    frame.src = PESAPAL_MONTHLY_URL;
  }
  if (frame) frame.style.display = '';
  if (loading) loading.style.display = 'none';
}

// ─── Handle wallet payment ──────────────────────────────────────────
async function handleWalletPay() {
  if (isProcessing) return;
  const amount = currentOptions?.amount || 0;
  if (window.GlitchItWallet && window.GlitchItWallet.canAfford(amount)) {
    isProcessing = true;
    const btn = overlay.querySelector('#pg-pay-btn');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    const txRef = currentOptions?.api_ref || generateTxRef();
    processWalletPayment(txRef);
    showSuccess({ ref: txRef, msg: `KES ${amount.toLocaleString()} paid from wallet.` });

    isProcessing = false;
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
  } else {
    toast('⚠', 'Insufficient wallet balance');
  }
}

// ─── Wallet payment processing ──────────────────────────────────────
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
function hideAllSteps() {
  ['pg-step-success','pg-step-error'].forEach((s) => {
    const el = overlay.querySelector(`#${s}`);
    if (el) el.style.display = 'none';
  });
}

function showStep(id) {
  hideAllSteps();
  const walletForm = overlay.querySelector('#pg-form-wallet');
  const pesapalArea = overlay.querySelector('#pg-pesapal-area');
  if (id === 'pg-step-success' || id === 'pg-step-error') {
    if (walletForm) walletForm.style.display = 'none';
    if (pesapalArea) pesapalArea.style.display = 'none';
  }
  const el = overlay.querySelector(`#${id}`);
  if (el) el.style.display = '';
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

function showCheckout() {
  hideAllSteps();
  const walletForm = overlay.querySelector('#pg-form-wallet');
  const pesapalArea = overlay.querySelector('#pg-pesapal-area');
  if (walletForm) walletForm.style.display = '';
  if (pesapalArea) pesapalArea.style.display = '';
  loadPesaPalFrame();
}

// ─── Open/close ─────────────────────────────────────────────────────
export function checkout(opts) {
  return new Promise((resolve, reject) => {
    currentOptions = opts || {};
    currentResolve = resolve;
    currentReject = reject;
    isProcessing = false;

    ensureOverlay();
    hideAllSteps();

    const amount = Number(opts.amount) || 0;
    overlay.querySelector('#pg-merchant-name').textContent = opts.title || 'GlitchIt';
    overlay.querySelector('#pg-merchant-desc').textContent = opts.description || '';
    overlay.querySelector('#pg-currency-label').textContent = opts.currency || 'KES';
    overlay.querySelector('#pg-total-amount').textContent = formatAmount(amount, opts.currency || 'KES');

    // Show wallet tab if user has enough balance
    const walletBal = window.GlitchItWallet ? window.GlitchItWallet.getBalance() : 0;
    const walletForm = overlay.querySelector('#pg-form-wallet');
    const pesapalArea = overlay.querySelector('#pg-pesapal-area');
    const walletBalEl = overlay.querySelector('#pg-wallet-bal');

    if (walletForm) walletForm.style.display = '';
    if (walletBalEl) walletBalEl.textContent = formatAmount(walletBal, 'KES');

    // If user can't afford from wallet, go straight to PesaPal
    if (walletBal >= amount && walletForm) {
      // Show both tabs, default to wallet
      walletForm.style.display = '';
      pesapalArea.style.display = 'none';
      if (walletBalEl) walletBalEl.textContent = formatAmount(walletBal, 'KES');
    } else {
      // Only PesaPal available
      walletForm.style.display = 'none';
      pesapalArea.style.display = '';
      loadPesaPalFrame();
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

function close() {
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  if (currentReject && !isProcessing) { currentReject(new Error('payment closed')); currentReject = null; currentResolve = null; }
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
  link.href = `${API_BASE}/src/payment-checkout.css?v=8`;
  document.head.appendChild(link);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
} else { injectStyles(); }

export { checkout as glitchitCheckout, formatAmount, generateTxRef };

try {
  window.GlitchItPaymentGateway = { checkout, glitchitCheckout: checkout, formatAmount, generateTxRef };
} catch(e) {}
