// Settings panel micro-interactions for the Accounts Center-inspired drawer.
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
    accounts: 'Your connected accounts are ready to review',
    'add-account': 'Add another account to Accounts Center',
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

  document.querySelectorAll('[data-setting]').forEach((item) => {
    item.addEventListener('click', () => showNotice(noticeText[item.dataset.setting] || 'Settings are ready to configure'));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.body.classList.remove('settings-open');
  });
})();
