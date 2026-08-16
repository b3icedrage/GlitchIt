// GlitchIt — social layer wiring (loaded AFTER src/main.js on the pages that
// render social UI: index, glitches, shop, messages, chat, activity, user).
//
// main.js renders the cards and handles navigation/auth; this script turns its
// actions into persisted behavior through src/social.js (localStorage, per
// user). It uses capture-phase document listeners so it can intercept clicks
// BEFORE main.js's original per-button handlers (which only animate counts),
// and it only stops propagation for signed-in users — guests fall through to
// main.js's existing "sign in" gate.
//
// The social module instance is shared: main.js publishes it on
// window.GLITCHIT_SOC and fires a 'glitchit:social' event; this script also
// imports the same module URL (browsers reuse the cached module instance).

(function () {
  let SOC = null;
  let wired = false;
  let identitySet = false;
  const startedAt = Date.now();

  window.addEventListener('glitchit:social', (event) => {
    SOC = event && event.detail;
    window.GLITCHIT_SOC = SOC;
    tryWire();
  });
  import('./social.js?v=5').then((mod) => {
    if (!window.GLITCHIT_SOC) { SOC = mod; window.GLITCHIT_SOC = mod; }
    tryWire();
  }).catch(() => { /* main.js will have reported it */ });

  // main.js's boot() is async — wait until it has decided who the user is
  // (signed-in user object or the guest flag) before wiring anything.
  function tryWire() {
    if (wired || !SOC) return;
    if (window.GLITCHIT_USER === undefined || window.GLITCHIT_USER === null) {
      if (Date.now() - startedAt < 6000) setTimeout(tryWire, 120);
      return;
    }
    wired = true;
    wire(SOC);
  }
  const bootPoll = setInterval(() => {
    if (wired) { clearInterval(bootPoll); return; }
    if (window.GLITCHIT_USER !== undefined && window.GLITCHIT_USER !== null) {
      clearInterval(bootPoll);
      tryWire();
    }
  }, 150);

  function wire(SOC) {
    if (!identitySet) {
      identitySet = true;
      SOC.setSocialUser(window.GLITCHIT_USER);
    }

    // ---------- Capture-phase action interception ----------
    document.addEventListener('click', (event) => {
      const target = event.target;

      const likeBtn = target.closest('.reel-like, .post-like');
      if (likeBtn) {
        if (isGuest()) return; // let main.js's sign-in gate handle guests
        handleLike(likeBtn, event);
        return;
      }
      const commentBtn = target.closest('button.reel-comment, .post-comment');
      if (commentBtn) {
        if (isGuest()) return;
        handleComment(commentBtn, event);
        return;
      }
      const shareBtn = target.closest('button.reel-share, .post-share');
      if (shareBtn) {
        if (isGuest()) return;
        handleShare(shareBtn, event);
        return;
      }
      const saveBtn = target.closest('.post-save');
      if (saveBtn) {
        if (isGuest()) return;
        handlePostSave(saveBtn, event);
        return;
      }
      const msgBtn = target.closest('.user-msg-btn');
      if (msgBtn) {
        if (isGuest()) {
          event.preventDefault();
          event.stopPropagation();
          showGuestGate('Sign in to message creators');
          return;
        }
        event.preventDefault();
        openDmWith(msgBtn.dataset.to, msgBtn.dataset.name);
        return;
      }
      const compose = target.closest('#dm-compose, #dm-compose-fab');
      if (compose) {
        event.preventDefault();
        event.stopPropagation();
        openDmPicker();
        return;
      }
      const newGroup = target.closest('#dm-new-group');
      if (newGroup) {
        event.preventDefault();
        event.stopPropagation();
        openGroupPicker();
        return;
      }
      const chip = target.closest('.interest-chip');
      if (chip) {
        toggleInterest(chip, event);
        return;
      }
      // Backdrop / close-button taps dismiss the sheets.
      if (target.closest('.comment-sheet-wrap') && (event.target === event.currentTarget || target.closest('.comment-sheet-close'))) {
        closeCommentSheet();
      }
      if (target.closest('.dm-picker-wrap') && (event.target === event.currentTarget || target.closest('.dm-picker-close'))) {
        closeDmPicker();
        closeGroupPicker();
      }
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (commentSheet) closeCommentSheet();
      if (dmPicker) closeDmPicker();
      if (groupPicker) closeGroupPicker();
    });

    // Re-render state after main.js finishes filling the feed asynchronously.
    new MutationObserver(() => scheduleSync()).observe(document.body, { childList: true, subtree: true });

    const page = document.body.dataset.page;
    if (page === 'home') attachInterestRow();
    if (page === 'notifications') hydrateActivity();
    if (page === 'messages') hydrateDmInbox();
    if (page === 'chat') hydrateChat();
    if (page === 'user') attachUserMessageBtn();
    // Creator replies (from src/social.js) land at any moment — keep the nav
    // badges and any open inbox/chat in sync wherever they arrive.
    window.addEventListener('glitchit:dm', refreshUnreadBadges);
    scheduleSync();
  }

  // ---------------- Likes (persisted) ----------------
  function handleLike(btn, event) {
    event.preventDefault();
    event.stopPropagation();
    const key = btn.dataset.mediaKey;
    if (!key) return;
    const on = SOC.toggleLike(key);
    btn.classList.toggle('liked', on);
    btn.setAttribute('aria-label', on ? 'Unlike' : 'Like');
    const count = btn.querySelector('b');
    if (count) count.textContent = String(SOC.totalLikes(key, Number(btn.dataset.baseCount) || 0));
    if (on) pushActivity('like', btn.classList.contains('reel-like') ? 'reel' : 'post');
  }

  // ---------------- Comments (bottom sheet) ----------------
  let commentSheet = null;

  function handleComment(btn, event) {
    event.preventDefault();
    event.stopPropagation();
    const key = btn.dataset.mediaKey;
    if (!key) return;
    openCommentSheet(key, Number(btn.dataset.baseCount) || 0);
  }

  function openCommentSheet(key, baseCount) {
    closeCommentSheet();
    const me = window.GLITCHIT_USER;
    const meName = (me && !me.guest && (me.user_metadata?.username || me.email?.split('@')[0])) || 'you';
    const meId = (me && !me.guest && me.id) || '';
    const wrap = document.createElement('div');
    wrap.className = 'comment-sheet-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Comments');
    wrap.innerHTML = `
      <div class="comment-sheet">
        <div class="comment-sheet-head">
          <img src="${escapeHtml((typeof profile !== 'undefined' && profile.avatar) || fallbackAvatar('you'))}" alt="">
          <div><b>Comments</b><em>${escapeHtml(meName)}</em></div>
          <button type="button" class="comment-sheet-close" aria-label="Close comments">×</button>
        </div>
        <div class="comment-list"></div>
        <form class="comment-sheet-form">
          <input type="text" maxlength="500" placeholder="Add a comment…" autocomplete="off" aria-label="Add a comment">
          <button type="submit">Post</button>
        </form>
      </div>`;
    document.body.appendChild(wrap);
    commentSheet = { wrap, key, baseCount, meName, meId, list: wrap.querySelector('.comment-list'), form: wrap.querySelector('form') };
    renderCommentList();
    const input = wrap.querySelector('input');
    input.focus();
    commentSheet.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const comment = SOC.addComment(commentSheet.key, text);
      if (!comment) return;
      input.value = '';
      renderCommentList();
      bumpCommentCounts(commentSheet.key);
      pushActivity('comment', 'post');
    });
  }

  function closeCommentSheet() {
    if (!commentSheet) return;
    commentSheet.wrap.remove();
    commentSheet = null;
  }

  function renderCommentList() {
    if (!commentSheet) return;
    const rows = SOC.commentsFor(commentSheet.key);
    if (!rows.length) {
      commentSheet.list.innerHTML = '<div class="comment-empty">No comments yet — be the first to say something.</div>';
      return;
    }
    commentSheet.list.innerHTML = rows.map((c) => {
      // Own comments get a delete affordance (userId when available, else the
      // legacy username match for comments written before userId was stored).
      const mine = commentSheet.meId ? c.userId === commentSheet.meId : c.username === commentSheet.meName;
      const del = mine ? `<button type="button" class="comment-del" data-comment-id="${escapeHtml(c.id)}" aria-label="Delete your comment">🗑</button>` : '';
      return `
      <div class="comment-row">
        <img src="${escapeHtml(c.avatar || fallbackAvatar(c.username))}" alt="${escapeHtml(c.username)}" loading="lazy">
        <div class="comment-row-main"><b>${escapeHtml(c.username)}</b><p>${escapeHtml(c.text)}</p><time>${SOC.timeAgo(c.at)}</time></div>
        ${del}
      </div>`;
    }).join('');
    commentSheet.list.querySelectorAll('.comment-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.commentId;
        if (!id || !SOC.deleteComment(commentSheet.key, id)) return;
        renderCommentList();
        bumpCommentCounts(commentSheet.key);
        glitchToast('Comment deleted');
      });
    });
  }

  function bumpCommentCounts(key) {
    document.querySelectorAll('button.reel-comment, .post-comment').forEach((btn) => {
      if (btn.dataset.mediaKey !== key) return;
      const count = btn.querySelector('b');
      if (count) count.textContent = String(SOC.totalComments(key, Number(btn.dataset.baseCount) || 0));
    });
  }

  // ---------------- Shares ----------------
  function handleShare(btn, event) {
    event.preventDefault();
    event.stopPropagation();
    const card = btn.closest('.video-card, .post');
    const title = card?.querySelector('video')?.getAttribute('aria-label')
      || card?.querySelector('.post-image')?.getAttribute('alt')
      || 'a GlitchIt post';
    const text = `Check out ${title} on GlitchIt`;
    const doShare = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'GlitchIt', text }); } catch (err) { /* user cancelled */ }
      } else if (navigator.clipboard) {
        try { await navigator.clipboard.writeText(text); glitchToast('Share text copied'); } catch (err) { /* ignore */ }
      } else {
        glitchToast('Sharing isn’t supported on this browser');
      }
    };
    doShare();
    pushActivity('share', btn.classList.contains('reel-share') ? 'reel' : 'post');
  }

  // ---------------- Save (posts — reels keep main.js's handler) ----------------
  function handlePostSave(btn, event) {
    event.preventDefault();
    event.stopPropagation();
    if (!DB || !window.GLITCHIT_USER || window.GLITCHIT_USER.guest) return;
    const card = btn.closest('.post');
    const item = {
      id: btn.dataset.videoId || btn.dataset.mediaKey || '',
      src: card?.querySelector('.post-image')?.getAttribute('src') || '',
      poster: '',
      title: card?.querySelector('.post-image')?.getAttribute('alt') || 'Post',
      caption: card?.querySelector('p')?.textContent?.trim() || '',
      user: card?.querySelector('.profile strong')?.textContent || 'you',
      avatar: card?.querySelector('.profile img')?.getAttribute('src') || (typeof profile !== 'undefined' && profile.avatar) || '',
    };
    const saving = btn.classList.toggle('saved');
    const done = (msg) => glitchToast(msg);
    if (saving) DB.saveVideo(item).then(() => done('Saved')).catch(() => { btn.classList.remove('saved'); done('Couldn’t save — try again'); });
    else DB.unsaveVideo(item).then(() => done('Removed from saved')).catch(() => { btn.classList.add('saved'); done('Couldn’t unsave — try again'); });
  }

  // ---------------- Activity feed (activity.html) ----------------
  function hydrateActivity() {
    const list = document.querySelector('.activity-list');
    if (!list) return;
    SOC.markActivityRead();
    refreshUnreadBadges();
    const events = SOC.myActivity();
    if (!events.length) {
      list.innerHTML = '<div class="activity-empty"><span class="activity-empty-mark">♡</span><h3>No activity yet</h3><p>Likes, comments, follows, and shares will show up here.</p></div>';
      return;
    }
    list.innerHTML = events.map((ev) => {
      const mark = { like: '♥', comment: '◌', share: '↗', follow: '＋', post: 'ϟ' }[ev.type] || '♡';
      return `
        <div class="activity-row">
          <span class="activity-username" title="@${escapeHtml(ev.actor || 'you')}">@${escapeHtml(ev.actor || 'you')}</span>
          <span class="activity-mark" aria-hidden="true">${mark}</span>
          <div class="activity-body"><p>${activityText(ev)}</p><time>${SOC.timeAgo(ev.at)} ago</time></div>
        </div>`;
    }).join('');
  }

  function activityText(ev) {
    const media = ev.mediaType === 'reel' ? 'reel' : 'post';
    if (ev.type === 'like') return `liked your ${media}.`;
    if (ev.type === 'comment') return `commented on your ${media}.`;
    if (ev.type === 'share') return `shared your ${media}.`;
    if (ev.type === 'follow') return `started following you.`;
    if (ev.type === 'post') return `posted a new ${media}.`;
    return `${escapeHtml(ev.text || 'interacted with your content')}.`;
  }

  function pushActivity(type, mediaType) {
    try {
      SOC.pushActivity({ type, mediaType, text: '' });
      refreshUnreadBadges();
    } catch (err) { /* never break the interaction */ }
  }

  // ---------------- Unread badges ----------------
  // Puts a small count bubble on the Activity and Messages nav links (sidebar,
  // mobile top bar, and bottom bar) whenever there's unread activity or an
  // unread incoming DM.
  function setBadge(el, n, label) {
    let badge = el.querySelector('.unread-badge');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('i');
        badge.className = 'unread-badge';
        el.appendChild(badge);
      }
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.setAttribute('aria-label', `${n} ${label}`);
    } else if (badge) {
      badge.remove();
    }
  }
  function refreshUnreadBadges() {
    if (!SOC) return;
    const n = SOC.unreadActivity();
    const dms = typeof SOC.unreadMessagesTotal === 'function'
      ? SOC.unreadMessagesTotal()
      : (typeof SOC.dmUnreadTotal === 'function' ? SOC.dmUnreadTotal() : 0);
    document.querySelectorAll('.top-activity-btn, .bottom-bar a[href="activity.html"], .sidebar nav a[href="activity.html"]').forEach((el) => setBadge(el, n, 'unread activity items'));
    document.querySelectorAll('.top-dm-btn, .bottom-bar a[href="messages.html"], .sidebar nav a[href="messages.html"]').forEach((el) => setBadge(el, dms, 'unread messages'));
  }

  // ---------------- Direct messages (inbox + chat) ----------------
  function openDmWith(key, name) {
    if (isGuest()) { showGuestGate('Sign in to message creators'); return; }
    const q = new URLSearchParams();
    q.set('to', String(key || ''));
    q.set('name', String(name || 'Creator'));
    location.href = `chat.html?${q.toString()}`;
  }

  function hydrateDmInbox() {
    const list = document.getElementById('dm-list');
    if (!list) return;
    const search = document.getElementById('dm-search-input');
    let lastSig = '';
    const render = () => {
      const convs = SOC.dmConversations();
      const groups = typeof SOC.groupConversations === 'function' ? SOC.groupConversations() : [];
      const lastAt = (c) => (c && c.messages && c.messages.length ? c.messages[c.messages.length - 1].at : 0);
      // 1:1 conversations and group chats share one inbox, most recent first.
      const items = [
        ...convs.map((c) => ({ kind: 'dm', c })),
        ...groups.map((g) => ({ kind: 'group', c: g })),
      ].sort((a, b) => lastAt(b.c) - lastAt(a.c));
      if (!items.length) {
        list.innerHTML = '<div class="dm-empty"><span class="dm-empty-mark">✉</span><h3>No messages yet</h3><p>Tap ＋ to message a creator you follow or start a group — chats show up here.</p></div>';
        return;
      }
      const unreadKeys = SOC.dmUnread();
      list.innerHTML = items.map((it) => {
        if (it.kind === 'group') return groupRowHtml(it.c);
        const c = it.c;
        const p = c.partner || {};
        const last = c.messages[c.messages.length - 1];
        const name = escapeHtml(p.name || 'Creator');
        const avatar = p.avatar
          ? `<img src="${escapeHtml(p.avatar)}" alt="${name}" loading="lazy">`
          : `<span class="badge"><i>${escapeHtml(String(p.name || 'C')[0].toUpperCase())}</i></span>`;
        const partnerKey = String(p.id || '');
        // Count every unseen message from this specific user, not just a dot:
        // the badge shows the number and the whole row glows while unread.
        const unreadCount = (typeof SOC.dmUnreadCount === 'function' ? SOC.dmUnreadCount(partnerKey) : (unreadKeys.includes(partnerKey) ? 1 : 0));
        const isUnread = unreadCount > 0;
        // Instagram-style preview line: message text + relative time on the
        // same line ("im good,, you?? · 23h"), no trailing camera icon.
        const time = last ? SOC.timeAgo(last.at) : '';
        const preview = last ? `${escapeHtml(last.text)}${time ? ` · ${time}` : ''}` : '';
        const q = new URLSearchParams();
        q.set('to', partnerKey);
        q.set('name', p.name || 'Creator');
        return `
        <a class="dm-row${isUnread ? ' dm-row-unread' : ''}" href="chat.html?${q.toString()}" ${isUnread ? `aria-label="${name}: ${unreadCount} unread messages"` : ''}>
          <span class="dm-avatar">${avatar}</span>
          <span class="dm-meta"><strong>${name}</strong><em>${preview}</em></span>
          ${isUnread ? `<i class="dm-unread-count" aria-hidden="true">${unreadCount > 9 ? '9+' : unreadCount}</i>` : ''}
        </a>`;
      }).join('');
      // The Primary pill shows how many conversations have unread messages.
      const countEl = document.querySelector('.dm-tab-count');
      if (countEl) {
        const unread = typeof SOC.unreadMessagesTotal === 'function'
          ? SOC.unreadMessagesTotal()
          : (typeof SOC.dmUnreadTotal === 'function' ? SOC.dmUnreadTotal() : 0);
        countEl.textContent = unread > 0 ? String(unread) : '';
      }
    };
    render();
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        list.querySelectorAll('.dm-row').forEach((row) => {
          row.classList.toggle('none', q.length > 0 && !row.textContent.toLowerCase().includes(q));
        });
      });
    }
    // While the inbox is open, land queued creator replies and re-render when
    // a conversation changes (new reply arrives).
    const poll = window.setInterval(() => {
      if (!SOC || document.body.dataset.page !== 'messages') { window.clearInterval(poll); return; }
      SOC.processPendingDmReplies();
      const dmSig = SOC.dmConversations().map((c) => `d${c.partner?.id || ''}:${c.messages.length}:${(c.messages[c.messages.length - 1] || {}).id || ''}`).join('|');
      const groupSig = (typeof SOC.groupConversations === 'function' ? SOC.groupConversations() : [])
        .map((g) => `g${g.id}:${g.messages.length}:${(g.messages[g.messages.length - 1] || {}).id || ''}`).join('|');
      const sig = `${dmSig}||${groupSig}`;
      if (sig !== lastSig) { lastSig = sig; render(); }
      refreshUnreadBadges();
    }, 4000);
  }

  // Group inbox row: stacked member avatars + name + last-message preview.
  function groupAvatarHtml(g) {
    const mems = ((g && g.members) || []).slice(0, 3);
    const tiles = mems.map((m, i) => {
      const nm = m.name || '?';
      return m.avatar
        ? `<img src="${escapeHtml(m.avatar)}" alt="" loading="lazy" style="--i:${i}">`
        : `<i class="gi" style="--i:${i}">${escapeHtml(String(nm)[0].toUpperCase())}</i>`;
    }).join('');
    return `<span class="dm-avatar group" aria-hidden="true">${tiles}</span>`;
  }

  function groupRowHtml(g) {
    const last = g.messages[g.messages.length - 1];
    const unreadCount = typeof SOC.groupUnreadCount === 'function' ? SOC.groupUnreadCount(g.id) : 0;
    const isUnread = unreadCount > 0;
    const time = last ? SOC.timeAgo(last.at) : '';
    const who = last && last.from === 'me' ? 'You: ' : (last && last.from !== 'system' && last.fromName ? `${last.fromName}: ` : '');
    const preview = `${who}${(last && last.text) || ''}${time ? ` · ${time}` : ''}`;
    const q = new URLSearchParams();
    q.set('group', g.id);
    return `
      <a class="dm-row${isUnread ? ' dm-row-unread' : ''}" href="chat.html?${q.toString()}" ${isUnread ? `aria-label="${escapeHtml(g.name)}: ${unreadCount} unread messages"` : ''}>
        ${groupAvatarHtml(g)}
        <span class="dm-meta"><strong>${escapeHtml(g.name)}</strong><em>${escapeHtml(preview)}</em></span>
        ${isUnread ? `<i class="dm-unread-count" aria-hidden="true">${unreadCount > 9 ? '9+' : unreadCount}</i>` : ''}
      </a>`;
  }

  function hydrateChat() {
    const body = document.getElementById('chat-body');
    const input = document.getElementById('chat-input');
    if (!body || !input) return;
    const params = new URLSearchParams(location.search);
    const to = String(params.get('to') || '').trim();
    const groupId = String(params.get('group') || '').trim();
    const name = String(params.get('name') || '').trim() || 'Creator';
    const isGroup = Boolean(groupId);
    const me = window.GLITCHIT_USER;
    const meId = (me && !me.guest && me.id) || '';
    const nameEl = document.getElementById('chat-name');
    const avatarEl = document.querySelector('.chat-avatar');
    const subEl = document.querySelector('.chat-id em');
    const userLink = document.querySelector('.chat-user');
    const curGroup = () => (typeof SOC.groupConversation === 'function' ? SOC.groupConversation(groupId) : null);

    if (isGroup) {
      const group = curGroup();
      if (!group) {
        if (nameEl) nameEl.textContent = 'Group not found';
        if (subEl) subEl.textContent = 'This group no longer exists';
        return;
      }
      if (nameEl) nameEl.textContent = group.name;
      // The member list excludes the creator, so the header count includes you.
      if (subEl) subEl.textContent = `${(group.members || []).length + 1} members · Group chat`;
      if (avatarEl) {
        const stack = document.createElement('span');
        stack.className = 'chat-avatar group';
        stack.setAttribute('aria-hidden', 'true');
        stack.innerHTML = ((group.members || []).slice(0, 3).map((m, i) => {
          const nm = m.name || '?';
          return m.avatar
            ? `<img src="${escapeHtml(m.avatar)}" alt="" style="--i:${i}">`
            : `<i class="gi" style="--i:${i}">${escapeHtml(String(nm)[0].toUpperCase())}</i>`;
        })).join('');
        avatarEl.replaceWith(stack);
      }
      if (userLink) {
        userLink.setAttribute('role', 'button');
        userLink.removeAttribute('href');
        userLink.addEventListener('click', (e) => {
          e.preventDefault();
          const cur = curGroup();
          if (!cur) return;
          glitchToast(`${cur.name}: ${cur.members.map((m) => m.name).join(', ')}`);
        });
      }
    } else {
      if (nameEl) nameEl.textContent = name;
      if (subEl) subEl.textContent = 'Creator on GlitchIt';
      if (avatarEl) {
        avatarEl.src = (typeof profile !== 'undefined' && profile.avatar) || fallbackAvatar(name);
        avatarEl.alt = `${name} avatar`;
      }
      if (userLink && to) userLink.href = `user.html?id=${encodeURIComponent(to)}&name=${encodeURIComponent(name)}`;
    }
    // The partner's real profile picture (from the creator list) makes the
    // header and the call screen show them instead of the local user.
    let partnerAvatar = '';
    if (!isGroup && to && DB && DB.loadCreators) {
      DB.loadCreators(100).then((rows) => {
        const found = rows.find((r) => String(r.id) === String(to));
        if (found && found.avatar) {
          partnerAvatar = found.avatar;
          if (avatarEl) avatarEl.src = found.avatar;
        }
      }).catch(() => {});
    }

    // The creator answers shortly after you message them; show a typing bubble
    // while the reply is on its way.
    let typing = false;
    const render = () => {
      const msgs = isGroup
        ? ((curGroup() || {}).messages || [])
        : ((to ? SOC.dmConversation(to) : null) || {}).messages || [];
      if (!msgs.length && !typing) {
        body.innerHTML = isGroup
          ? '<div class="chat-empty"><span class="chat-empty-mark">◨</span><h3>Nothing here yet</h3><p>Say hi to the group — messages will show up here.</p></div>'
          : '<div class="chat-empty"><span class="chat-empty-mark">✉</span><h3>No conversation yet</h3><p>Say hi — your messages with this creator will show up here.</p></div>';
        return;
      }
      const typingRow = typing ? '<div class="msg in msg-typing-row" aria-label="They are typing"><span class="msg-typing"><i></i><i></i><i></i></span></div>' : '';
      body.innerHTML = msgs.map((m) => {
        if (m.from === 'system') return `<div class="msg system"><span>${escapeHtml(m.text)}</span></div>`;
        if (m.from === 'me') return `<div class="msg out"><span>${escapeHtml(m.text)}</span></div>`;
        if (isGroup) {
          const av = m.fromAvatar || fallbackAvatar(m.fromName || 'Member');
          return `<div class="msg in group-msg"><img class="msg-avatar" src="${escapeHtml(av)}" alt="${escapeHtml(m.fromName || 'Member')}" loading="lazy"><div><b>${escapeHtml(m.fromName || 'Member')}</b><span>${escapeHtml(m.text)}</span></div></div>`;
        }
        return `<div class="msg in"><span>${escapeHtml(m.text)}</span></div>`;
      }).join('') + typingRow;
      body.scrollTop = body.scrollHeight;
    };
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      if (isGuest()) { showGuestGate('Sign in to message creators'); return; }
      if (isGroup) {
        if (!groupId || !SOC.groupSend(groupId, text)) { glitchToast('This group no longer exists'); return; }
        input.value = '';
        const cur = curGroup();
        const others = ((cur && cur.members) || []).filter((m) => String(m.id) !== String(meId));
        if (others.length && typeof SOC.scheduleGroupReply === 'function') {
          SOC.scheduleGroupReply(groupId, others[Math.floor(Math.random() * others.length)]);
        }
        render();
        refreshUnreadBadges();
        return;
      }
      if (!to) { glitchToast('Pick someone to message first'); return; }
      SOC.dmSend(to, { name, avatar: '' }, text);
      input.value = '';
      SOC.scheduleCreatorReply(to, { name, avatar: '' }, { story: /story|glitch|reel/i.test(text) });
      typing = true;
      render();
      // Safety net: if the reply never lands (offline etc.), drop the bubble.
      window.setTimeout(() => { if (typing) { typing = false; render(); } }, 8000);
      refreshUnreadBadges();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); send(); }
    });
    // Opening the conversation marks it read (DMs and groups alike).
    if (isGroup) { if (typeof SOC.groupMarkRead === 'function') SOC.groupMarkRead(groupId); }
    else if (to) SOC.dmMarkRead(to);
    const onDm = (event) => {
      const keys = event && event.detail && event.detail.keys;
      const activeKey = isGroup ? groupId : to;
      if (!activeKey || (Array.isArray(keys) && !keys.includes(activeKey))) return;
      typing = false;
      render();
      if (isGroup) { if (typeof SOC.groupMarkRead === 'function') SOC.groupMarkRead(groupId); }
      else SOC.dmMarkRead(to);
      refreshUnreadBadges();
    };
    window.addEventListener('glitchit:dm', onDm);
    // Land any replies queued while this page was loading, and re-render when
    // one arrives while the chat stays open.
    const poll = window.setInterval(() => {
      if (!SOC || document.body.dataset.page !== 'chat') { window.clearInterval(poll); return; }
      SOC.processPendingDmReplies();
      if (typing) { typing = false; render(); }
    }, 4000);
    // Audio / video call buttons: 1:1 chats call the partner, groups call the
    // whole room. The overlay itself lives in src/calls.js (GLITCHIT_CALLS).
    document.querySelectorAll('.chat-act[data-call]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (isGuest()) { showGuestGate('Sign in to call creators'); return; }
        if (!window.GLITCHIT_CALLS || typeof window.GLITCHIT_CALLS.startCall !== 'function') {
          glitchToast('Calling isn’t available right now');
          return;
        }
        const mode = btn.dataset.call === 'video' ? 'video' : 'audio';
        if (isGroup) {
          const cur = curGroup();
          if (!cur) { glitchToast('This group no longer exists'); return; }
          window.GLITCHIT_CALLS.startCall({ mode, kind: 'group', groupName: cur.name, members: cur.members });
          return;
        }
        if (!to) { glitchToast('Pick someone to call first'); return; }
        window.GLITCHIT_CALLS.startCall({
          mode,
          kind: 'direct',
          target: { id: to, name, avatar: partnerAvatar || fallbackAvatar(name) },
        });
      });
    });
    render();
  }

  // ---------------- New-message picker (messages page) ----------------
  let dmPicker = null;

  async function openDmPicker() {
    if (dmPicker) { dmPicker.wrap.hidden = false; return; }
    const wrap = document.createElement('div');
    wrap.className = 'dm-picker-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'New message');
    wrap.innerHTML = `
      <div class="dm-picker">
        <div class="dm-picker-head"><b>New message</b><button type="button" class="dm-picker-close" aria-label="Close">×</button></div>
        <div class="dm-picker-list"></div>
      </div>`;
    document.body.appendChild(wrap);
    dmPicker = { wrap, list: wrap.querySelector('.dm-picker-list') };
    wrap.querySelector('.dm-picker-close').addEventListener('click', closeDmPicker);
    wrap.addEventListener('click', (event) => { if (event.target === wrap) closeDmPicker(); });
    let rows = [];
    try {
      rows = DB && DB.loadCreators ? (await DB.loadCreators(30)) : [];
    } catch (err) { rows = []; }
    const me = window.GLITCHIT_USER;
    renderDmPicker(rows.filter((c) => !me || c.id !== me.id));
  }

  function renderDmPicker(rows) {
    if (!dmPicker) return;
    if (!rows.length) {
      dmPicker.list.innerHTML = '<div class="dm-pick-empty">No creators to message yet — follow someone from Search and they’ll appear here.</div>';
      return;
    }
    dmPicker.list.innerHTML = rows.map((c) => {
      const handle = c.handle || String(c.id).slice(0, 8);
      const avatar = c.avatar
        ? `<img src="${escapeHtml(c.avatar)}" alt="" loading="lazy">`
        : `<img src="${fallbackAvatar(handle)}" alt="" loading="lazy">`;
      return `<button type="button" class="dm-pick" data-to="${escapeHtml(c.id)}" data-name="${escapeHtml(handle)}">${avatar}<span><b>${escapeHtml(handle)}</b><em>Creator</em></span></button>`;
    }).join('');
    dmPicker.list.querySelectorAll('.dm-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeDmPicker();
        openDmWith(btn.dataset.to, btn.dataset.name);
      });
    });
  }

  function closeDmPicker() {
    if (!dmPicker) return;
    dmPicker.wrap.remove();
    dmPicker = null;
  }

  // ---------------- New-group picker (messages page) ----------------
  // Bottom sheet with a group-name field and a multi-select of creators; the
  // created group opens in the chat page.
  let groupPicker = null;

  async function openGroupPicker() {
    if (groupPicker) { groupPicker.wrap.hidden = false; return; }
    const wrap = document.createElement('div');
    wrap.className = 'dm-picker-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'New group');
    wrap.innerHTML = `
      <div class="dm-picker group-picker">
        <div class="dm-picker-head"><b>New group</b><button type="button" class="dm-picker-close" aria-label="Close">×</button></div>
        <div class="group-picker-name"><input type="text" maxlength="60" placeholder="Group name (optional)" aria-label="Group name" autocomplete="off"></div>
        <div class="dm-picker-list"></div>
        <div class="group-picker-foot">
          <span class="group-picker-count">0 selected</span>
          <button type="button" class="group-picker-create" disabled>Create group</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    groupPicker = {
      wrap,
      list: wrap.querySelector('.dm-picker-list'),
      input: wrap.querySelector('.group-picker-name input'),
      count: wrap.querySelector('.group-picker-count'),
      create: wrap.querySelector('.group-picker-create'),
      selected: new Set(),
    };
    wrap.querySelector('.dm-picker-close').addEventListener('click', closeGroupPicker);
    wrap.addEventListener('click', (event) => { if (event.target === wrap) closeGroupPicker(); });
    groupPicker.create.addEventListener('click', () => {
      if (!groupPicker || !groupPicker.selected.size) return;
      const name = groupPicker.input.value.trim();
      const members = [];
      groupPicker.list.querySelectorAll('.group-pick.selected').forEach((btn) => {
        members.push({ id: btn.dataset.id, name: btn.dataset.name, avatar: btn.dataset.avatar });
      });
      const group = SOC.createGroup(name, members);
      closeGroupPicker();
      if (!group) { glitchToast('Couldn’t create the group'); return; }
      location.href = `chat.html?group=${encodeURIComponent(group.id)}`;
    });
    let rows = [];
    try {
      rows = DB && DB.loadCreators ? (await DB.loadCreators(50)) : [];
    } catch (err) { rows = []; }
    const me = window.GLITCHIT_USER;
    renderGroupMembers(rows.filter((c) => !me || String(c.id) !== String(me.id)));
  }

  function renderGroupMembers(rows) {
    if (!groupPicker) return;
    if (!rows.length) {
      groupPicker.list.innerHTML = '<div class="dm-pick-empty">No creators to add yet — follow someone from Search and they’ll appear here.</div>';
      return;
    }
    groupPicker.list.innerHTML = rows.map((c) => {
      const handle = c.handle || c.username || String(c.id).slice(0, 8);
      const avatar = c.avatar ? escapeHtml(c.avatar) : fallbackAvatar(handle);
      return `<button type="button" class="group-pick" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(handle)}" data-avatar="${escapeHtml(c.avatar || '')}" aria-pressed="false"><img src="${escapeHtml(avatar)}" alt="" loading="lazy"><span><b>${escapeHtml(handle)}</b><em>Creator</em></span><i class="group-pick-check" aria-hidden="true">✓</i></button>`;
    }).join('');
    groupPicker.list.querySelectorAll('.group-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const on = !groupPicker.selected.has(id);
        if (on) groupPicker.selected.add(id); else groupPicker.selected.delete(id);
        btn.classList.toggle('selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        updateGroupPickerFoot();
      });
    });
    updateGroupPickerFoot();
  }

  function updateGroupPickerFoot() {
    if (!groupPicker) return;
    const n = groupPicker.selected.size;
    groupPicker.count.textContent = n ? `${n} selected` : '0 selected';
    groupPicker.create.disabled = n === 0;
  }

  function closeGroupPicker() {
    if (!groupPicker) return;
    groupPicker.wrap.remove();
    groupPicker = null;
  }

  // ---------------- Message button (user.html) ----------------
  // The button ships in the page markup (hidden until a target is known); this
  // fills it with the creator id + name from the URL and reveals it. It also
  // creates the button on pages where the markup is missing, so the Message
  // action never depends on a single code path.
  function attachUserMessageBtn() {
    const row = document.querySelector('.user-actions');
    if (!row) return;
    const params = new URLSearchParams(location.search);
    const to = String(params.get('id') || '').trim();
    const name = String(params.get('name') || '').trim() || 'Creator';
    let btn = document.getElementById('user-msg-btn') || row.querySelector('.user-msg-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'user-msg-btn';
      btn.textContent = 'Message';
      row.appendChild(btn);
    }
    btn.hidden = !to;
    if (!to) return;
    btn.dataset.to = to;
    btn.dataset.name = name;
    btn.textContent = 'Message';
    btn.setAttribute('aria-label', `Message ${name}`);
  }

  // ---------------- Interest chips (home feed) ----------------
  const INTERESTS = [
    { key: 'Space & Science', icon: '🚀' },
    { key: 'Art & Design', icon: '🎨' },
    { key: 'Music', icon: '🎵' },
    { key: 'Gaming', icon: '🎮' },
    { key: 'Fashion', icon: '🛍️' },
    { key: 'Fitness', icon: '💪' },
    { key: 'Food & Drink', icon: '🍜' },
    { key: 'Travel', icon: '✈️' },
    { key: 'Tech & AI', icon: '💻' },
    { key: 'Nature', icon: '🌿' },
  ];
  const INTERESTS_KEY = 'glitchit.interests.v1';
  const INTEREST_WORDS = {
    'Space & Science': ['space', 'nasa', 'galaxy', 'science', 'mars', 'star', 'universe', 'rocket', 'astro'],
    'Art & Design': ['art', 'design', 'draw', 'paint', 'sketch', 'doodle', 'illustration', 'poster', 'mural'],
    'Music': ['music', 'song', 'beat', 'sound', 'sing', 'rap', 'band', 'concert', 'track', 'note', 'guitar'],
    'Gaming': ['game', 'gaming', 'playstation', 'xbox', 'nintendo', 'esports', 'minecraft', 'fortnite', 'arcade'],
    'Fashion': ['fashion', 'outfit', 'style', 'wear', 'streetwear', 'sneaker', 'vintage', 'fit', 'drop'],
    'Fitness': ['fitness', 'gym', 'workout', 'run', 'training', 'yoga', 'lift', 'health', 'cardio'],
    'Food & Drink': ['food', 'eat', 'recipe', 'coffee', 'cook', 'snack', 'drink', 'brunch', 'meal', 'taste'],
    'Travel': ['travel', 'trip', 'beach', 'city', 'adventure', 'vacation', 'road', 'flight', 'journey'],
    'Tech & AI': ['tech', 'ai', 'robot', 'code', 'gadget', 'app', 'computer', 'phone', 'future', 'coding'],
    'Nature': ['nature', 'ocean', 'forest', 'mountain', 'wild', 'plant', 'sky', 'sunset', 'outdoor', 'garden'],
  };

  function readInterests() {
    try {
      const list = JSON.parse(localStorage.getItem(INTERESTS_KEY) || '[]');
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (err) { return []; }
  }
  function writeInterests(list) {
    try { localStorage.setItem(INTERESTS_KEY, JSON.stringify(list)); } catch (err) { /* storage unavailable */ }
  }

  function attachInterestRow() {
    const feed = document.getElementById('upload-feed');
    if (!feed || document.querySelector('.interest-row')) return;
    let saved = readInterests();
    // Seed once from the interests chosen during signup.
    const user = window.GLITCHIT_USER;
    if (user && !user.guest && user.user_metadata && Array.isArray(user.user_metadata.interests) && user.user_metadata.interests.length && !saved.length) {
      saved = user.user_metadata.interests;
      writeInterests(saved);
    }
    const row = document.createElement('div');
    row.className = 'interest-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Filter your feed by interest');
    row.innerHTML = INTERESTS.map((it) => `
      <button type="button" class="interest-chip${saved.includes(it.key) ? ' active' : ''}" data-interest="${escapeHtml(it.key)}" aria-pressed="${saved.includes(it.key) ? 'true' : 'false'}">${it.icon} ${escapeHtml(it.key)}</button>`).join('');
    feed.before(row);
    row.querySelectorAll('.interest-chip').forEach((chip) => {
      chip.addEventListener('click', () => toggleInterest(chip));
    });
    applyInterestOrder(saved);
  }

  function toggleInterest(chip, event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const key = chip.dataset.interest;
    if (!key) return;
    let saved = readInterests();
    const on = !saved.includes(key);
    saved = on ? [...saved, key] : saved.filter((k) => k !== key);
    writeInterests(saved);
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    applyInterestOrder(saved);
    glitchToast(on ? `Showing more ${key} in your feed` : `Showing less ${key} in your feed`);
  }

  // Reorder feed cards so posts matching the selected interests surface first.
  function applyInterestOrder(saved) {
    const feed = document.getElementById('upload-feed');
    if (!feed) return;
    const cards = [...feed.querySelectorAll('.post, .video-card')];
    if (!cards.length) return;
    if (!saved.length) {
      cards.forEach((card) => feed.appendChild(card));
      return;
    }
    const words = saved.flatMap((key) => INTEREST_WORDS[key] || []);
    const score = (card) => {
      const text = (card.textContent || '').toLowerCase();
      return words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    };
    cards.sort((a, b) => score(b) - score(a));
    cards.forEach((card) => feed.appendChild(card));
  }

  // ---------------- Count sync (re-renders + late DB loads) ----------------
  let syncTimer = null;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncCounts();
      // DB posts arrive after the feed is first rendered — keep the selected
      // interest ordering applied to them too.
      if (document.body.dataset.page === 'home' && readInterests().length) applyInterestOrder(readInterests());
    }, 200);
  }
  function syncCounts() {
    if (!SOC) return;
    document.querySelectorAll('.reel-like[data-media-key], .post-like[data-media-key]').forEach((btn) => {
      const key = btn.dataset.mediaKey;
      const base = Number(btn.dataset.baseCount) || 0;
      const liked = SOC.isLiked(key);
      btn.classList.toggle('liked', liked);
      btn.setAttribute('aria-label', liked ? 'Unlike' : 'Like');
      const count = btn.querySelector('b');
      if (count) {
        const total = String(SOC.totalLikes(key, base));
        if (count.textContent !== total) count.textContent = total;
      }
    });
    document.querySelectorAll('button.reel-comment, .post-comment').forEach((btn) => {
      const count = btn.querySelector('b');
      if (!count) return;
      const total = String(SOC.totalComments(btn.dataset.mediaKey, Number(btn.dataset.baseCount) || 0));
      if (count.textContent !== total) count.textContent = total;
    });
    refreshUnreadBadges();
  }
})();
