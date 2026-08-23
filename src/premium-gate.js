// GlitchIt Premium Gate — shared across every page
// Checks if the signed-in user has an active premium subscription and applies
// premium-specific UI: blue badge, disabled wallet deposit, disabled "Get Premium" CTA.
// Content is shared between premium and normal users — only the UI chrome changes.

(function () {
  'use strict';

  // ─── Premium Detection ─────────────────────────────────────────────
  function isPremium() {
    try {
      var u = window.GLITCHIT_USER;
      if (!u || !u.id || u.guest) return false;

      // 1. Check Supabase user_metadata first (authoritative)
      var cp = u.user_metadata && u.user_metadata.premium;
      if (cp && cp.expiresAt && Date.now() < cp.expiresAt) return true;

      // 2. Fallback: localStorage cache
      var raw = localStorage.getItem('glitchit.premium.' + u.id);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.expiresAt && Date.now() < d.expiresAt) return true;
      }

      // 3. Check blue badge (granted alongside premium)
      var badge = localStorage.getItem('glitchit.badge.' + u.id);
      if (badge) {
        var bd = JSON.parse(badge);
        if (bd && bd.type === 'verified') {
          // Badge exists — check if premium data exists too
          if (cp && cp.expiresAt) return Date.now() < cp.expiresAt;
          if (raw) {
            var pd = JSON.parse(raw);
            if (pd && pd.expiresAt) return Date.now() < pd.expiresAt;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function getPremiumExpiry() {
    try {
      var u = window.GLITCHIT_USER;
      if (!u || !u.id) return 0;
      var cp = u.user_metadata && u.user_metadata.premium;
      if (cp && cp.expiresAt) return cp.expiresAt;
      var raw = localStorage.getItem('glitchit.premium.' + u.id);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.expiresAt) return d.expiresAt;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  function formatTimeLeft(expiresAt) {
    var remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    var days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    var hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    var mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    if (days > 0) return days + 'd ' + hours + 'h left';
    if (hours > 0) return hours + 'h ' + mins + 'm left';
    return mins + 'm left';
  }

  // ─── Blue Badge Injection ──────────────────────────────────────────
  var BADGE_STYLE = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#0095f6;color:#fff;font-size:11px;margin-left:6px;vertical-align:middle;flex-shrink:0;';

  function injectBlueBadge(el) {
    if (!el || el.querySelector('.blue-badge-premium')) return;
    var badge = document.createElement('span');
    badge.className = 'blue-badge-premium';
    badge.innerHTML = '\u2713';
    badge.title = 'Verified Premium';
    badge.style.cssText = BADGE_STYLE;
    el.appendChild(badge);
  }

  function addBadgeToProfileNames() {
    var selectors = [
      '.profile-name',
      '.handle-text',
      '.right-rail .me strong',
      '.me strong',
      '#profile-name',
      '#user-name',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        // Don't duplicate if already has badge or verified bolt
        if (el.querySelector('.blue-badge-premium') || el.querySelector('.verified-bolt')) return;
        injectBlueBadge(el);
      });
    });
  }

  // ─── Disable Premium CTA ───────────────────────────────────────────
  function disablePremiumButtons() {
    // Disable "Get Premium" buttons
    document.querySelectorAll('.prem-cta:not(.pay-wallet-btn)').forEach(function (btn) {
      btn.disabled = true;
      btn.style.background = 'linear-gradient(135deg, #00c853, #00e676)';
      btn.style.cursor = 'default';
      btn.textContent = '\u2713 You\u2019re Premium';
    });

    // Disable "Pay with Wallet" on premium page (premium users don't need to buy again)
    document.querySelectorAll('.prem-cta.pay-wallet-btn').forEach(function (btn) {
      btn.style.display = 'none';
    });

    // Hide any "Get Premium" links/buttons in nav or other pages
    document.querySelectorAll('[data-premium-cta]').forEach(function (el) {
      el.style.display = 'none';
    });

    // Update eyebrow on premium page
    var eyebrow = document.querySelector('.prem-hero .eyebrow');
    if (eyebrow) {
      eyebrow.innerHTML = '\u2714 GlitchIt Premium Active';
      eyebrow.style.borderColor = 'rgba(0, 200, 83, .35)';
      eyebrow.style.background = 'rgba(0, 200, 83, .08)';
      eyebrow.style.color = '#00c853';
    }
  }

  // ─── Disable Wallet Deposit (allow tipping only) ───────────────────
  function disableWalletDeposit() {
    // Disable deposit button
    var depositBtn = document.getElementById('deposit-btn');
    if (depositBtn) {
      depositBtn.disabled = true;
      depositBtn.style.opacity = '0.5';
      depositBtn.style.cursor = 'not-allowed';
      depositBtn.title = 'Premium accounts: wallet deposit disabled for 30 days';
    }

    // Disable quick amount buttons
    document.querySelectorAll('.wallet-quick-btn').forEach(function (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    });

    // Disable custom amount input
    var customInput = document.getElementById('custom-amount');
    if (customInput) {
      customInput.disabled = true;
      customInput.style.opacity = '0.5';
      customInput.placeholder = 'Deposit disabled for premium users';
    }

    // Add info banner in wallet
    var depositSection = document.getElementById('deposit-section');
    if (depositSection && !depositSection.querySelector('.premium-info-banner')) {
      var banner = document.createElement('div');
      banner.className = 'premium-info-banner';
      banner.style.cssText = 'background:rgba(0,150,246,.1);border:1px solid rgba(0,150,246,.25);border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#0096f6;';
      banner.innerHTML = '\u2714 <strong>Premium Active</strong> \u2014 Wallet deposit is disabled for 30 days. You can still tip and reward other users.';
      depositSection.insertBefore(banner, depositSection.firstChild);
    }
  }

  // ─── Premium Badge in Profile Photo ────────────────────────────────
  function addBadgeToProfilePhoto() {
    document.querySelectorAll('.profile-photo-wrap').forEach(function (wrap) {
      if (wrap.querySelector('.blue-badge-premium')) return;
      var badge = document.createElement('span');
      badge.className = 'blue-badge-premium';
      badge.style.cssText = 'position:absolute;bottom:2px;right:2px;width:22px;height:22px;border-radius:50%;background:#0095f6;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;z-index:2;';
      badge.innerHTML = '\u2713';
      badge.title = 'Verified Premium';
      wrap.style.position = 'relative';
      wrap.appendChild(badge);
    });
  }

  // ─── Main Gate Function ────────────────────────────────────────────
  function applyPremiumGate() {
    var active = isPremium();
    if (!active) return; // Non-premium users see normal UI

    var expiry = getPremiumExpiry();

    // 1. Add blue badge to profile names everywhere
    addBadgeToProfileNames();

    // 2. Add badge to profile photo
    addBadgeToProfilePhoto();

    // 3. Disable "Get Premium" buttons
    disablePremiumButtons();

    // 4. Disable wallet deposit (if on wallet page)
    disableWalletDeposit();

    // 5. Add premium indicator to body for CSS hooks
    document.body.classList.add('premium-active');

    // 6. Listen for user-badge-granted event (from payment-gateway.js)
    document.addEventListener('user-badge-granted', function () {
      addBadgeToProfileNames();
      addBadgeToProfilePhoto();
    });

    // 7. Update countdown timer on premium page
    if (expiry > 0) {
      var premBtn = document.querySelector('.prem-cta:not(.pay-wallet-btn)');
      if (premBtn && premBtn.disabled) {
        function updateCountdown() {
          if (Date.now() >= expiry) {
            premBtn.disabled = false;
            premBtn.style.background = '';
            premBtn.style.cursor = '';
            premBtn.textContent = 'Get Premium';
            document.body.classList.remove('premium-active');
            return;
          }
          premBtn.textContent = '\u2713 Active \u2014 ' + formatTimeLeft(expiry);
          setTimeout(updateCountdown, 60000);
        }
        updateCountdown();
      }
    }
  }

  // ─── Auto-run on page load ─────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      // Wait a tick for GLITCHIT_USER to be set by auth module
      setTimeout(applyPremiumGate, 100);
    });
  } else {
    setTimeout(applyPremiumGate, 100);
  }

  // ─── Re-apply when auth state changes ──────────────────────────────
  document.addEventListener('user-badge-granted', function () {
    setTimeout(applyPremiumGate, 50);
  });

  // ─── Public API ────────────────────────────────────────────────────
  window.GlitchItPremium = {
    isPremium: isPremium,
    applyGate: applyPremiumGate,
    getExpiry: getPremiumExpiry,
    formatTimeLeft: formatTimeLeft,
  };
})();
