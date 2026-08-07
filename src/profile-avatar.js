// GlitchIt — authenticated profile avatar hydration and placeholder cleanup.
(function () {
  'use strict';

  function fallbackAvatar(label) {
    var initials = String(label || 'G').trim().split(/[^a-z0-9]+/i).filter(Boolean).slice(0, 2).map(function (part) { return part[0].toUpperCase(); }).join('') || 'G';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="avatar-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect width="120" height="120" rx="60" fill="url(#avatar-gradient)"/><text x="60" y="67" fill="#fff" font-family="Arial,sans-serif" font-size="38" font-weight="700" text-anchor="middle">' + initials + '</text></svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function validAvatar(value) {
    var url = String(value || '').trim();
    return /^(?:https?:\/\/|data:image\/|blob:)/i.test(url) && !/[<>"']/.test(url) ? url : '';
  }

  function getAvatar(user, handle) {
    var metadata = user && user.user_metadata || {};
    var identity = user && user.identities && user.identities[0] && user.identities[0].identity_data || {};
    return [metadata.avatar_url, metadata.picture, metadata.avatar, metadata.image, identity.avatar_url, identity.picture].map(validAvatar).filter(Boolean)[0] || fallbackAvatar(handle || 'GlitchIt');
  }

  function removePlaceholders(root) {
    if (!root || root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.matches && root.matches('[placeholder]')) root.removeAttribute('placeholder');
    root.querySelectorAll && root.querySelectorAll('[placeholder]').forEach(function (field) {
      field.removeAttribute('placeholder');
    });
  }

  function apply() {
    removePlaceholders(document);
    var user = window.GLITCHIT_USER;
    var metadata = user && user.user_metadata || {};
    var handle = metadata.username || user && user.email && user.email.split('@')[0] || 'b3ice_drage';
    var avatar = getAvatar(user, handle);

    document.querySelectorAll('.me img, .profile-photo-wrap > img, .story-create img, .ig-profiles .profile-avatar:not(.gray) img').forEach(function (image) {
      image.src = avatar;
      image.alt = handle + ' profile picture';
    });

    document.querySelectorAll('a[href="profile.html"]').forEach(function (link) {
      if (!link.closest('.bottom-bar, .sidebar nav')) return;
      var icon = link.querySelector('.profile-nav-avatar');
      if (!icon) {
        icon = document.createElement('img');
        icon.className = 'profile-nav-avatar';
        var oldIcon = link.querySelector('.icon, svg');
        if (oldIcon) oldIcon.replaceWith(icon);
      }
      icon.src = avatar;
      icon.alt = handle + ' profile';
    });
  }

  var attempts = 0;
  function hydrate() {
    apply();
    attempts += 1;
    if (attempts < 30 && !window.GLITCHIT_USER) window.setTimeout(hydrate, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hydrate, { once: true });
  else hydrate();

  // Main page scripts create note, music, and editor fields after their deferred
  // script has started. Keep the UI placeholder-free without touching user input.
  if (window.MutationObserver) {
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          removePlaceholders(node);
        });
      });
      apply();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
