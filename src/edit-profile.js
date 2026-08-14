// GlitchIt — edit profile + story replies (loaded AFTER src/main.js).
//
// main.js owns the page hydrations; this layer adds two social upgrades on
// top of it, using the same capture-phase interception pattern as
// src/social-wire.js so it never has to edit main.js itself:
//
//   1. Edit-profile sheet (profile page). The "Edit profile" button shares
//      the settings-drawer class in main.js, so this script intercepts its
//      click (capture phase, before the drawer toggles) and opens a real
//      Instagram-style sheet: display name, @username, pronouns, and bio.
//      Saves to Supabase user_metadata when signed in (the same keys the
//      account registry reads, so edits appear on public profiles and in
//      search immediately) and mirrors to localStorage for instant UI.
//
//   2. Story replies become real DMs. The story viewer's "Send message"
//      field currently only shows a toast. When the story belongs to a
//      known creator (the header links to user.html?id=…), this script
//      intercepts the submit, stores the message as a DM, and queues the
//      creator's auto-reply (src/social.js) — so the reply lands in the
//      Messages inbox with an unread badge.
(function () {
  'use strict';

  const startedAt = Date.now();

  // Wait until main.js's async boot has decided who the user is before
  // wiring anything that depends on identity (like isGuest()).
  function boot() {
    if (window.GLITCHIT_USER === undefined || window.GLITCHIT_USER === null) {
      if (Date.now() - startedAt < 6000) setTimeout(boot, 120);
      return;
    }
    wire();
  }

  function wire() {
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('#edit-profile-btn');
      if (!btn) return;
      event.preventDefault();
      // Stop the settings-drawer toggle that main.js bound to this button.
      event.stopPropagation();
      if (window.isGuest()) { window.showGuestGate('Sign in to edit your profile'); return; }
      openEditProfileSheet();
    }, true);

    // Story viewer "Send message" -> real DM to the creator.
    document.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-sv-msg]');
      if (!form) return;
      const viewer = form.closest('.story-viewer');
      if (!viewer) return;
      const idLink = viewer.querySelector('.sv-id');
      const href = (idLink && idLink.getAttribute('href')) || '';
      const match = href.match(/user\.html\?id=([^&]+)(?:&name=([^&]*))?/);
      // Own stories (and legacy demo trays) link to profile.html — let
      // main.js's toast handle those.
      if (!match) return;
      const input = form.querySelector('input');
      const text = (input && input.value || '').trim();
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      if (input) input.value = '';
      const to = decodeURIComponent(match[1]);
      const name = decodeURIComponent(match[2] || 'Creator');
      const me = window.GLITCHIT_USER;
      const soc = window.GLITCHIT_SOC;
      if (soc && soc.dmSend && me && !me.guest) {
        soc.dmSend(to, { name, avatar: '' }, text);
        if (soc.scheduleCreatorReply) soc.scheduleCreatorReply(to, { name, avatar: '' }, { story: true });
        window.glitchToast(`Reply sent to ${name} — check your Messages`);
        try {
          window.dispatchEvent(new CustomEvent('glitchit:dm', { detail: { keys: [to] } }));
        } catch (err) { /* ignore */ }
      } else {
        window.glitchToast(`Message sent to ${name}`);
      }
    }, true);
  }

  // ---------------- Edit-profile sheet ----------------
  const PROFILE_NAME_KEY = 'glitchit.name';
  const PROFILE_PRONOUNS_KEY = 'glitchit.pronouns';

  function readLocal(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  function openEditProfileSheet() {
    if (document.getElementById('edit-profile-sheet')) return;
    const me = window.GLITCHIT_USER;
    const meta = (me && me.user_metadata) || {};
    const handle = meta.username || (me && me.email && me.email.split('@')[0]) || (typeof profile !== 'undefined' && profile.username) || 'you';
    const name = meta.full_name || meta.name || readLocal(PROFILE_NAME_KEY, '') || handle;
    const pronouns = meta.pronouns || readLocal(PROFILE_PRONOUNS_KEY, '');
    const bio = meta.bio || window.readStore('glitchit.bio', '');
    const esc = (v) => window.escapeHtml(String(v || ''));
    const wrap = document.createElement('div');
    wrap.id = 'edit-profile-sheet';
    wrap.className = 'editprofile-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Edit profile');
    wrap.innerHTML = `
      <div class="editprofile-backdrop" data-ep-close></div>
      <section class="editprofile-sheet">
        <header class="editprofile-head">
          <button type="button" class="editprofile-cancel" data-ep-close>Cancel</button>
          <strong>Edit profile</strong>
          <button type="button" class="editprofile-done" data-ep-done>Done</button>
        </header>
        <div class="editprofile-body">
          <div class="editprofile-field">
            <label for="ep-name">Name</label>
            <input id="ep-name" type="text" maxlength="40" value="${esc(name)}" autocomplete="off">
          </div>
          <div class="editprofile-field">
            <label for="ep-username">Username</label>
            <div class="editprofile-input-wrap"><span class="editprofile-atsign" aria-hidden="true">@</span><input id="ep-username" type="text" maxlength="30" value="${esc(handle)}" autocomplete="off" spellcheck="false"></div>
          </div>
          <div class="editprofile-field">
            <label for="ep-pronouns">Pronouns</label>
            <input id="ep-pronouns" type="text" maxlength="30" value="${esc(pronouns)}" placeholder="e.g. she/her" autocomplete="off">
          </div>
          <div class="editprofile-field">
            <label for="ep-bio">Bio</label>
            <textarea id="ep-bio" maxlength="220" rows="3" placeholder="Tell people what you're about…">${esc(bio)}</textarea>
            <small class="editprofile-count" id="ep-bio-count">${bio.length}/220</small>
          </div>
        </div>
      </section>`;
    document.body.appendChild(wrap);
    const nameInput = wrap.querySelector('#ep-name');
    const userInput = wrap.querySelector('#ep-username');
    const pronInput = wrap.querySelector('#ep-pronouns');
    const bioInput = wrap.querySelector('#ep-bio');
    const count = wrap.querySelector('#ep-bio-count');

    bioInput.addEventListener('input', () => { count.textContent = `${bioInput.value.length}/220`; });

    const close = (saved) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      if (saved) window.glitchToast('Profile updated');
    };
    wrap.querySelectorAll('[data-ep-close]').forEach((el) => el.addEventListener('click', () => close(false)));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(false); });
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);

    wrap.querySelector('[data-ep-done]').addEventListener('click', async () => {
      const nextName = nameInput.value.trim();
      const nextHandle = userInput.value.trim().replace(/^@/, '').replace(/\s+/g, '');
      const nextPronouns = pronInput.value.trim();
      const nextBio = bioInput.value.trim();
      if (!nextHandle) { window.glitchToast('Username can’t be empty'); userInput.focus(); return; }
      writeLocal(PROFILE_NAME_KEY, nextName);
      writeLocal(PROFILE_PRONOUNS_KEY, nextPronouns);
      window.writeStore('glitchit.bio', nextBio);
      if (me && !me.guest) {
        if (!me.user_metadata) me.user_metadata = {};
        if (nextName) me.user_metadata.full_name = nextName;
        me.user_metadata.username = nextHandle;
        me.user_metadata.pronouns = nextPronouns;
        me.user_metadata.bio = nextBio;
        window.GLITCHIT_USER = me;
        const authMod = window.GLITCHIT_AUTH;
        if (authMod && authMod.updateUserMetadata) {
          try {
            const res = await authMod.updateUserMetadata({ full_name: nextName, username: nextHandle, pronouns: nextPronouns, bio: nextBio });
            if (res && res.ok && res.user) window.GLITCHIT_USER = res.user;
          } catch (err) { /* offline — kept locally */ }
        }
      }
      window.applyCurrentUserProfile();
      const top = document.querySelector('.profile-topbar strong');
      if (top) top.textContent = nextHandle;
      const nameEl = document.querySelector('.profile-name');
      if (nameEl) {
        const pron = nextPronouns ? ` <span class="pronouns">${window.escapeHtml(nextPronouns)}</span>` : '';
        nameEl.innerHTML = `${window.escapeHtml(nextHandle)}${pron}`;
      }
      const textEl = document.getElementById('profile-bio-text');
      if (textEl) textEl.textContent = nextBio || 'Your bio will appear here — tap Edit profile to add one.';
      // Keep the social layer (comments / activity identity) in sync.
      const soc = window.GLITCHIT_SOC;
      if (soc && soc.setSocialUser) soc.setSocialUser(window.GLITCHIT_USER);
      close(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
