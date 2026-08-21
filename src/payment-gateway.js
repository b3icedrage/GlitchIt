// GlitchIt Pay — payment gateway
// Premium payments go through external PesaPal store links.
// Shop/wallet payments are handled in-app.

function formatAmount(amount, currency = 'USD') {
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
        <div class="pg-currency" id="pg-currency-label">$</div>
        <div class="pg-total" id="pg-total-amount">0</div>
      </div>

      <!-- Step 1: Buyer details -->
      <div class="pg-buyer-details" id="pg-buyer-details">
        <div class="pg-form">
          <div class="pg-field">
            <label for="pg-full-name">Full name</label>
            <input type="text" id="pg-full-name" placeholder="John Doe" autocomplete="name" />
          </div>
          <div class="pg-field">
            <label for="pg-email">Email address</label>
            <input type="email" id="pg-email" placeholder="john@example.com" autocomplete="email" inputmode="email" />
          </div>
          <div class="pg-field">
            <label for="pg-momo-number">Phone number</label>
            <div class="pg-momo-field">
              <input type="text" id="pg-momo-code" class="pg-country-code" value="+254" maxlength="5" />
              <input type="text" id="pg-momo-number" placeholder="712 345 678" inputmode="tel" />
            </div>
          </div>
        </div>
        <button type="button" class="pg-pay-btn" id="pg-continue-btn">
          <span class="pg-pay-btn-text">Continue to Payment</span>
          <span class="pg-spinner"></span>
        </button>
      </div>

      <!-- Wallet payment -->
      <div class="pg-form" id="pg-form-wallet" style="display:none;">
        <div class="pg-info-box" style="text-align:center;">
          <strong>Pay from GlitchIt Wallet</strong><br>
          Balance: <strong id="pg-wallet-bal">$0</strong>
        </div>
        <button type="button" class="pg-pay-btn" id="pg-pay-btn">
          <span class="pg-pay-btn-text">Pay from Wallet</span>
        </button>
      </div>

      <!-- External payment link area (for non-wallet payments) -->
      <div class="pg-form" id="pg-external-link" style="display:none;text-align:center;padding:20px;">
        <p style="font-size:14px;color:#8e8e8e;margin-bottom:16px;">You'll be redirected to complete payment.</p>
        <button type="button" class="pg-pay-btn" id="pg-open-link-btn" style="background:linear-gradient(135deg,#171717,#333);">
          <span class="pg-pay-btn-text">Open Payment Page</span>
        </button>
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

  // Continue to payment button
  const continueBtn = overlay.querySelector('#pg-continue-btn');
  if (continueBtn) continueBtn.addEventListener('click', handleContinue);

  // Wallet pay button
  const payBtn = overlay.querySelector('#pg-pay-btn');
  if (payBtn) payBtn.addEventListener('click', handleWalletPay);

  // Done / Retry
  const doneBtn = overlay.querySelector('#pg-done-btn');
  if (doneBtn) doneBtn.addEventListener('click', close);
  const retryBtn = overlay.querySelector('#pg-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', showCheckout);
}

// ─── Validate buyer details → show payment methods ──────────────────
function handleContinue() {
  const fullName = overlay.querySelector('#pg-full-name')?.value.trim();
  const email = overlay.querySelector('#pg-email')?.value.trim();
  const phone = overlay.querySelector('#pg-momo-number')?.value.replace(/\s/g, '');
  if (!fullName || fullName.length < 2) return fieldError('pg-full-name', 'Enter your full name');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fieldError('pg-email', 'Enter a valid email address');
  if (!phone || phone.length < 9) return fieldError('pg-momo-number', 'Enter a valid phone number');

  // Store buyer details for the payment
  currentOptions._buyerName = fullName;
  currentOptions._buyerEmail = email;
  currentOptions._buyerPhone = (overlay.querySelector('#pg-momo-code')?.value || '+254') + phone;

  showPaymentMethods();
}

function fieldError(id, msg) {
  const el = overlay.querySelector(`#${id}`);
  if (el) { el.style.borderColor = '#ff3b30'; el.focus(); }
  toast('⚠', msg);
}

async function showPaymentMethods() {
  const details = overlay.querySelector('#pg-buyer-details');
  const walletForm = overlay.querySelector('#pg-form-wallet');
  if (details) details.style.display = 'none';

  // Check wallet balance
  const amount = Number(currentOptions?.amount) || 0;
  const walletBal = window.GlitchItWallet ? window.GlitchItWallet.getBalance() : 0;
  if (walletBal >= amount && walletForm) {
    walletForm.style.display = '';
  } else {
    // Use PesaPal PostPesapalDirectOrderV4 (API 3.0 SubmitOrderRequest)
    // Create order via our backend, get redirect_url, then redirect user
    const txRef = currentOptions?.api_ref || generateTxRef();
    const buyer = {
      first_name: currentOptions._buyerName?.split(' ')[0] || currentOptions._buyerName || 'Customer',
      last_name: currentOptions._buyerName?.split(' ').slice(1).join(' ') || '',
      email: currentOptions._buyerEmail || '',
      phone: currentOptions._buyerPhone || '',
    };

    // Show loading state
    const continueBtn = overlay.querySelector('#pg-continue-btn');
    if (continueBtn) { continueBtn.classList.add('loading'); continueBtn.disabled = true; }

    try {
      const response = await fetch('/api/gateway/v1/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: buyer.first_name,
          last_name: buyer.last_name,
          email: buyer.email,
          phone: buyer.phone,
          amount: amount,
          currency: 'KES',
          description: currentOptions?.title || 'GlitchIt Payment',
          tx_ref: txRef,
          callback_url: window.location.origin + '/premium.html?from_pesapal=1',
        }),
      });

      const data = await response.json();

      if (data.success && data.data && data.data.redirect_url) {
        // Store tracking ID for status checking when user returns
        localStorage.setItem('pesapal_pending_tx', data.data.order_tracking_id || txRef);
        localStorage.setItem('pesapal_payment_amount', amount);
        localStorage.setItem('pesapal_payment_title', currentOptions?.title || 'Premium');

        // Redirect to PesaPal checkout page
        window.location.href = data.data.redirect_url;
      } else {
        if (continueBtn) { continueBtn.classList.remove('loading'); continueBtn.disabled = false; }
        toast('\u274c', data.message || 'Failed to create payment order');
        showCheckout();
      }
    } catch (err) {
      console.error('[PesaPal] Order creation failed:', err);
      if (continueBtn) { continueBtn.classList.remove('loading'); continueBtn.disabled = false; }
      toast('\u274c', 'Payment connection failed — please try again');
      showCheckout();
    }
  }
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
    showSuccess({ ref: txRef, msg: `$${amount.toLocaleString()} paid from wallet.` });

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
  const details = overlay.querySelector('#pg-buyer-details');
  if (details) details.style.display = 'none';
}

function showStep(id) {
  hideAllSteps();
  const walletForm = overlay.querySelector('#pg-form-wallet');
  const details = overlay.querySelector('#pg-buyer-details');
  const extLink = overlay.querySelector('#pg-external-link');
  if (id === 'pg-step-success' || id === 'pg-step-error') {
    if (walletForm) walletForm.style.display = 'none';
    if (details) details.style.display = 'none';
    if (extLink) extLink.style.display = 'none';
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
  const details = overlay.querySelector('#pg-buyer-details');
  const walletForm = overlay.querySelector('#pg-form-wallet');
  const extLink = overlay.querySelector('#pg-external-link');
  if (details) details.style.display = '';
  if (walletForm) walletForm.style.display = 'none';
  if (extLink) extLink.style.display = 'none';
  // Pre-fill from user data if available
  const user = window.GLITCHIT_USER;
  if (user && !user.guest) {
    const nameEl = overlay.querySelector('#pg-full-name');
    const emailEl = overlay.querySelector('#pg-email');
    if (nameEl && !nameEl.value) nameEl.value = user.user_metadata?.full_name || user.user_metadata?.username || '';
    if (emailEl && !emailEl.value) emailEl.value = user.email || '';
  }
  setTimeout(() => overlay.querySelector('#pg-full-name')?.focus(), 300);
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
    overlay.querySelector('#pg-currency-label').textContent = opts.currency === 'KES' ? 'KES' : '$';
    overlay.querySelector('#pg-total-amount').textContent = formatAmount(amount, opts.currency || 'USD');

    // Show wallet balance
    const walletBal = window.GlitchItWallet ? window.GlitchItWallet.getBalance() : 0;
    const walletForm = overlay.querySelector('#pg-form-wallet');
    const walletBalEl = overlay.querySelector('#pg-wallet-bal');

    if (walletForm) walletForm.style.display = '';
    if (walletBalEl) walletBalEl.textContent = formatAmount(walletBal, 'USD');

    // Always start with buyer details form
    const details = overlay.querySelector('#pg-buyer-details');
    if (details) details.style.display = '';
    walletForm.style.display = 'none';

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => overlay.querySelector('#pg-full-name')?.focus(), 300);
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

// ─── Payment Status Checker (runs on page load) ─────────────────────
// Checks if user returned from PesaPal after payment.
// PesaPal redirects back with OrderTrackingId as a query parameter.
async function checkPaymentStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const orderTrackingId = urlParams.get('OrderTrackingId') || urlParams.get('order_tracking_id');
  const pendingTx = localStorage.getItem('pesapal_pending_tx');

  const trackingId = orderTrackingId || pendingTx;
  if (!trackingId) return;

  // Clean up URL
  window.history.replaceState({}, document.title, window.location.pathname);

  // Check transaction status with backend
  try {
    const response = await fetch(`/api/gateway/v1/pesapal/status/${trackingId}`);
    const data = await response.json();

    if (data.success && data.data) {
      const status = data.data.status || data.data.payment_status;

      if (status === 'COMPLETED' || status === 'VERIFIED') {
        giveBlueBadge();
        localStorage.removeItem('pesapal_pending_tx');
        showToast('\u2705', 'Payment successful! You now have a verified badge.');
      } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'REJECTED') {
        localStorage.removeItem('pesapal_pending_tx');
        showToast('\u274c', 'Payment was cancelled or failed.');
      } else {
        if (!window._pesapalPollAttempts) window._pesapalPollAttempts = 0;
        window._pesapalPollAttempts++;
        if (window._pesapalPollAttempts < 30) {
          setTimeout(checkPaymentStatus, 3000);
        } else {
          localStorage.removeItem('pesapal_pending_tx');
          showToast('\u26a0\ufe0f', 'Payment still pending \u2014 check again later.');
        }
        return;
      }
    }
  } catch (err) {
    console.error('[PesaPal] Status check failed:', err);
    if (!window._pesapalPollAttempts) window._pesapalPollAttempts = 0;
    window._pesapalPollAttempts++;
    if (window._pesapalPollAttempts < 10) {
      setTimeout(checkPaymentStatus, 3000);
    }
  }
}

// ─── Blue Badge System ──────────────────────────────────────────────
function giveBlueBadge() {
  const user = window.GLITCHIT_USER;
  if (!user || !user.id) return;

  // Store badge in localStorage
  const badgeKey = `glitchit.badge.${user.id}`;
  localStorage.setItem(badgeKey, JSON.stringify({
    type: 'verified',
    color: 'blue',
    granted_at: new Date().toISOString(),
    reason: 'payment_verified'
  }));

  // Add badge element to profile if visible
  const nameEl = document.querySelector('[data-stat="username"], .profile-name, #profile-name');
  if (nameEl && !nameEl.querySelector('.blue-badge')) {
    const badge = document.createElement('span');
    badge.className = 'blue-badge';
    badge.innerHTML = '✓';
    badge.title = 'Verified Account';
    badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#0095f6;color:#fff;font-size:11px;margin-left:6px;vertical-align:middle;';
    nameEl.appendChild(badge);
  }

  // Dispatch event for other modules
  document.dispatchEvent(new CustomEvent('user-badge-granted', { detail: { type: 'blue' } }));
}

function hasBlueBadge() {
  const user = window.GLITCHIT_USER;
  if (!user || !user.id) return false;
  const badgeKey = `glitchit.badge.${user.id}`;
  const badge = localStorage.getItem(badgeKey);
  return badge !== null;
}

function showToast(mark, text) {
  const tip = document.createElement('div');
  tip.className = 'end-toast show';
  tip.innerHTML = `<span class="end-toast-mark">${mark}</span><span class="end-toast-text">${text}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 3000);
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPaymentStatus, { once: true });
} else {
  checkPaymentStatus();
}

export { checkout as glitchitCheckout, formatAmount, generateTxRef, giveBlueBadge, hasBlueBadge };

try {
  window.GlitchItPaymentGateway = { checkout, glitchitCheckout: checkout, formatAmount, generateTxRef, giveBlueBadge, hasBlueBadge };
} catch(e) {}
