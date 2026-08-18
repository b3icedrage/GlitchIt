// Settings panel micro-interactions for the Accounts Center-inspired drawer,
// plus the Instagram-style account switcher bottom sheet on the profile page.
(function attachSettingsEnhancements() {
  const noticeText = {
    profiles: 'Sharing across profiles is ready to configure',
    'accounts-login': 'Choose which accounts can log you in',
    'view-all': 'All account settings are available here',
    security: 'Password and security is ready to configure',
    'personal-details': 'Personal details is ready to configure',
    permissions: 'Information and permissions is ready to configure',
    ads: 'Ad preferences is ready to configure',
    pay: 'Meta Pay is ready to configure',
    verified: 'Meta Verified is ready to configure',
  };

  const showNotice = (message) => {
    let notice = document.getElementById('settings-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'settings-notice';
      notice.className = 'settings-notice';
      notice.setAttribute('role', 'status');
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('show');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => notice.classList.remove('show'), 1800);
  };

  // ---- Account switcher bottom sheet (Instagram-style) ----
  const backdrop = document.getElementById('account-sheet-backdrop');
  const sheet = document.getElementById('account-sheet');

  // Fill the sheet with the signed-in user's real handle + avatar.
  const hydrateAccountSheet = () => {
    const user = window.GLITCHIT_USER;
    const metadata = user && user.user_metadata || {};
    const handle = (user && !user.guest && (metadata.username || (user.email && user.email.split('@')[0]))) || 'you';
    const nameEl = document.getElementById('account-current-name');
    if (nameEl) nameEl.textContent = handle;
    // Prefer the already-hydrated profile photo so the sheet matches the page.
    const avatar = document.querySelector('.profile-photo-wrap img')?.getAttribute('src') || '';
    const img = document.getElementById('account-current-avatar');
    if (img && avatar) img.src = avatar;
  };

  const openAccountSheet = () => {
    if (!sheet) return;
    hydrateAccountSheet();
    document.body.classList.add('account-sheet-open');
  };
  const closeAccountSheet = () => document.body.classList.remove('account-sheet-open');

  document.getElementById('account-switch-btn')?.addEventListener('click', openAccountSheet);
  backdrop?.addEventListener('click', closeAccountSheet);

  // "Add GlitchIt account" -> sign-up / sign-in flow (guests land here too).
  sheet?.querySelector('[data-account-add]')?.addEventListener('click', () => {
    location.href = 'auth.html';
  });

  // "Go to Accounts Center" -> open the full settings drawer.
  sheet?.querySelector('[data-account-center]')?.addEventListener('click', () => {
    closeAccountSheet();
    document.body.classList.add('settings-open');
  });

  // Settings rows: the Accounts rows open the switcher sheet, the rest toast.
  document.querySelectorAll('[data-setting]').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.dataset.setting === 'accounts' || item.dataset.setting === 'add-account') {
        openAccountSheet();
        return;
      }
      showNotice(noticeText[item.dataset.setting] || 'Settings are ready to configure');
    });
  });

  // Escape closes either the settings drawer or the account sheet.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.body.classList.remove('settings-open');
    document.body.classList.remove('account-sheet-open');
  });

  // ---- Scroll-driven button crossfade ----
  // Settings rows/buttons fade out as they scroll out of the drawer and fade
  // back in as they re-enter, so new buttons appear while old ones dissolve.
  // The observer only activates when supported and the user hasn't asked for
  // reduced motion; otherwise every button stays fully visible.
  const scrollEl = document.querySelector('.settings-scroll');
  if (scrollEl && 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const ROW_SELECTOR = '.settings-row, .settings-view-all, .settings-add-account, #auth-logout';
    const rows = [...scrollEl.querySelectorAll(ROW_SELECTOR)];
    if (rows.length) {
      scrollEl.classList.add('rows-crossfade');
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('row-in-view', entry.isIntersecting);
        });
      }, {
        root: scrollEl,
        rootMargin: '0px 0px -14% 0px',
        threshold: 0.15,
      });
      const recheck = () => {
        observer.disconnect();
        rows.forEach((row) => observer.observe(row));
      };
      rows.forEach((row) => observer.observe(row));
      // The drawer slides in/out with a transform; re-observing on open/close
      // makes fresh callbacks mark exactly what is currently on screen.
      new MutationObserver(recheck).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }
})();
