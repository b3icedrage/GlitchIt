// GlitchIt — story features layer (loaded AFTER src/main.js).
// The story viewer + storage helpers live in src/main.js. This file upgrades
// the parts that sit below main.js's editing boundary:
//   - 24h story expiry (prunes glitchit.story.mine / .latest)
//   - the home shelf rebuilt from creator trays (swipe between creators),
//     real DB stories, and close-friends filtering
//   - story highlights on the profile page (they never expire)
//   - the Close Friends manager sheet in profile settings
// It overrides the matching global functions so every call site across the
// app (runPage, the viewer's delete flow, …) picks up the upgraded versions.
(function () {
  'use strict';

  // main.js declares these globals (const/let/function) — reference them,
  // never redeclare: STORY_TTL, STORY_LATEST_KEY, STORY_MINE_KEY,
  // STORY_REACTIONS, storyTrays, storyExpired, storyAgeLabel, readStore,
  // writeStore, storyReactionState, reactToStory, storyViewRecord,
  // storyViewCount, recordStoryView, readHighlights, writeHighlights,
  // addStoryToHighlights, removeStoryFromHighlights, readCloseFriends,
  // writeCloseFriends, isCloseFriendOf, canViewStory, attachStoryLinks,
  // openStoryViewer, clearStoryLatest, escapeHtml, glitchToast, profile,
  // userUploads, saveUploads, DB, displayUser, fallbackAvatar.

  // ---------- 24h story expiry ----------
  function storyMine() {
    const list = readStore(STORY_MINE_KEY, []);
    if (!Array.isArray(list)) return [];
    const fresh = list.filter((m) => m && !storyExpired(m));
    if (fresh.length !== list.length) writeStore(STORY_MINE_KEY, fresh);
    return fresh;
  }
  function storyLatest() {
    const latest = readStore(STORY_LATEST_KEY, null);
    return latest && !storyExpired(latest) ? latest : null;
  }

  // ---------- Home shelf: creator trays + DB stories + close friends ----------
  function hydrateStoryShelf() {
    const shelf = document.querySelector('.stories');
    if (!shelf) return;
    shelf.querySelectorAll('.story[data-story-dynamic="true"]').forEach((link) => link.remove());

    const mine = storyMine();
    const latest = mine[0] || storyLatest();
    const avatar = profile.avatar || fallbackAvatar(profile.username || 'You');
    const user = window.GLITCHIT_USER;
    const myId = user && !user.guest ? user.id : '';

    // Build the ordered creator trays (tray 0 = "Your story") so the viewer
    // can swipe between creators. storyTrays is a main.js `let` — reassign,
    // don't redeclare.
    storyTrays = [];
    const pushTray = (tray) => { storyTrays.push(tray); return storyTrays.length - 1; };
    const trayRing = (trayIndex, name, items) => {
      const link = document.createElement('a');
      link.className = 'story';
      link.href = '#';
      link.dataset.storyDynamic = 'true';
      link.dataset.storyTray = String(trayIndex);
      link.setAttribute('aria-label', `Open ${name}'s stories`);
      const thumb = items[0].image;
      link.innerHTML = `<span class="story-ring live"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(name)} avatar">${items.length > 1 ? `<i class="story-count" aria-hidden="true">${items.length}</i>` : ''}</span><span>${escapeHtml(name)}</span>`;
      return link;
    };

    let selfRing;
    if (mine.length) {
      const items = mine.map((m) => ({
        name: 'Your story',
        image: m.poster || m.url,
        live: false,
        own: true,
        reveal: Boolean(m.reveal),
        closeFriends: Boolean(m.closeFriends),
        key: 'mine:' + m.at,
      }));
      const trayIndex = pushTray({ creator: 'Your story', avatar: items[0].image, stories: items });
      selfRing = `<a class="story story-self" data-story-dynamic="true" data-story-tray="${trayIndex}" aria-label="View your stories"><span class="story-ring live"><img src="${items[0].image}" alt="Your story">${items.length > 1 ? `<i class="story-count" aria-hidden="true">${items.length}</i>` : ''}</span><span>Your story</span></a>`;
    } else if (latest) {
      const item = { name: 'Your story', image: latest.poster || latest.url, live: false, own: true, reveal: Boolean(latest.reveal), closeFriends: Boolean(latest.closeFriends), key: 'mine:' + latest.at };
      const trayIndex = pushTray({ creator: 'Your story', avatar: item.image, stories: [item] });
      selfRing = `<a class="story story-self" data-story-dynamic="true" data-story-tray="${trayIndex}" aria-label="View your story"><span class="story-ring live"><img src="${item.image}" alt="Your story"></span><span>Your story</span></a>`;
    } else {
      selfRing = `<a class="story story-self" data-story-dynamic="true" href="camera.html" aria-label="Create a story"><span class="story-ring live"><img src="${avatar}" alt="You"><i class="story-self-badge" aria-hidden="true">＋</i></span><span>Your story</span></a>`;
    }
    shelf.insertAdjacentHTML('afterbegin', selfRing);

    // Real stories from the database (kind='story'), grouped by creator. Own
    // rows come from the local mirror above, so they don't duplicate here.
    // Rows past the 24h window are skipped.
    if (DB) {
      DB.loadMedia('story', 60).then((rows) => {
        // Group by the owner uuid (stable) with a display name per group, so
        // each tray can carry the creatorId the viewer needs for its profile
        // link — two accounts with the same short-id label never collide.
        const byOwner = new Map();
        (rows || []).forEach((row) => {
          if (!row || !row.url || !row.user || (myId && row.user === myId)) return;
          const at = Date.parse(row.created_at || '') || Date.now();
          if (!Number.isFinite(at) || Date.now() - at > STORY_TTL) return;
          const creator = displayUser(row.user) || String(row.user).slice(0, 8);
          const reveal = Boolean(row.reveal);
          const closeFriends = Boolean(row.close_friends);
          // Close-friends stories only surface for accounts on the viewer's
          // close-friends list (same rule the legacy demo stories use).
          if (closeFriends && !canViewStory({ closeFriends: true }, creator)) return;
          let group = byOwner.get(row.user);
          if (!group) {
            group = { creator, items: [] };
            byOwner.set(row.user, group);
          }
          group.items.push({
            name: creator,
            image: row.poster || row.url,
            live: false,
            own: false,
            reveal,
            closeFriends,
            key: 'db:' + row.id,
          });
        });
        byOwner.forEach((group, ownerId) => {
          const trayIndex = pushTray({ creator: group.creator, avatar: group.items[0].image, creatorId: ownerId, stories: group.items });
          shelf.appendChild(trayRing(trayIndex, group.creator, group.items));
        });
        attachStoryLinks();
      });
    }

    // Legacy demo stories (kept so fresh installs still have shelf content).
    // Close-friends stories are hidden from everyone except the creator and
    // the accounts on the creator's close-friends list.
    const byCreator = new Map();
    [...userUploads.stories].reverse().forEach((story) => {
      const title = story.title || 'Someone';
      if (!byCreator.has(title)) byCreator.set(title, []);
      byCreator.get(title).push(story);
    });
    byCreator.forEach((list, title) => {
      const items = list
        .filter((s) => !storyExpired(s) && canViewStory(s, title))
        .map((s) => ({ name: title, image: s.preview, live: true, own: false, reveal: Boolean(s.reveal), closeFriends: Boolean(s.closeFriends), key: 'demo:' + title + ':' + list.indexOf(s) }));
      if (!items.length) return;
      const trayIndex = pushTray({ creator: title, avatar: items[0].image, stories: items });
      shelf.appendChild(trayRing(trayIndex, title, items));
    });
    attachStoryLinks();
  }

  // ---------- Story highlights (profile page) ----------
  // Saved stories never expire — they render as rings on the profile page and
  // replay through the same viewer (where they can be removed again).
  function hydrateHighlights() {
    const container = document.querySelector('.highlights');
    if (!container) return;
    const highlights = readHighlights();
    if (!highlights.length) {
      if (!container.querySelector('.highlights-empty')) {
        container.innerHTML = '<p class="highlights-empty">No highlights yet — save a story from the story viewer to keep it here.</p>';
      }
      return;
    }
    container.innerHTML = highlights.map((h, i) => {
      const thumb = h.image || (h.stories[0] && h.stories[0].image) || fallbackAvatar(h.name || 'Highlights');
      const count = h.stories.length;
      return `<a class="highlight" href="#" data-highlight-index="${i}" aria-label="Open ${escapeHtml(h.name)} highlights"><span><img src="${escapeHtml(thumb)}" alt="${escapeHtml(h.name)}" loading="lazy"></span><em>${escapeHtml(h.name)}${count > 1 ? ` (${count})` : ''}</em></a>`;
    }).join('');
    container.querySelectorAll('[data-highlight-index]').forEach((ring) => {
      ring.addEventListener('click', (e) => {
        e.preventDefault();
        const h = highlights[Number(ring.dataset.highlightIndex)];
        if (!h || !h.stories || !h.stories.length) return;
        openStoryViewer([{ creator: h.name, avatar: h.image, stories: h.stories }]);
      });
    });
  }

  // ---------- Close friends manager (profile settings) ----------
  // A sheet in profile settings lists the real accounts; toggling one adds or
  // removes it from the close-friends list, which gates "Close friends only"
  // stories on the home shelf.
  let cfSheetBound = false;
  function attachCloseFriendsSheet() {
    const openBtn = document.querySelector('[data-setting="close-friends"]');
    const backdrop = document.getElementById('cf-sheet-backdrop');
    const sheet = document.getElementById('cf-sheet');
    const listEl = document.getElementById('cf-list');
    if (!openBtn || !sheet || !listEl) return;
    if (cfSheetBound) return;
    cfSheetBound = true;
    const open = () => {
      document.body.classList.add('cf-sheet-open');
      renderCloseFriendsList();
    };
    const close = () => document.body.classList.remove('cf-sheet-open');
    openBtn.addEventListener('click', open);
    backdrop?.addEventListener('click', close);
    async function renderCloseFriendsList() {
      listEl.innerHTML = '<p class="cf-empty">Loading accounts…</p>';
      let creators = [];
      if (DB) creators = await DB.loadCreators(80);
      const friends = readCloseFriends();
      const user = window.GLITCHIT_USER;
      const myId = user && !user.guest ? user.id : '';
      const others = creators.filter((c) => !myId || c.id !== myId);
      if (!others.length) {
        listEl.innerHTML = '<p class="cf-empty">No accounts yet — accounts that post will show up here.</p>';
        return;
      }
      listEl.innerHTML = others.map((c) => {
        const name = c.handle || String(c.id).slice(0, 8);
        const on = friends.some((f) => f.id === c.id || f.name === name);
        const avatar = c.avatar
          ? `<img src="${escapeHtml(c.avatar)}" alt="">`
          : `<span class="cf-avatar-fallback">${escapeHtml((name[0] || 'G').toUpperCase())}</span>`;
        return `<button type="button" class="cf-row${on ? ' on' : ''}" data-cf-id="${escapeHtml(c.id)}" data-cf-name="${escapeHtml(name)}" aria-pressed="${on}"><span class="cf-avatar">${avatar}</span><span class="cf-name">${escapeHtml(name)}</span><span class="cf-toggle" aria-hidden="true"><i></i></span></button>`;
      }).join('');
      listEl.querySelectorAll('.cf-row').forEach((row) => {
        row.addEventListener('click', () => {
          const friendsNow = readCloseFriends();
          const at = friendsNow.findIndex((f) => f.id === row.dataset.cfId || f.name === row.dataset.cfName);
          if (at === -1) friendsNow.push({ id: row.dataset.cfId, name: row.dataset.cfName });
          else friendsNow.splice(at, 1);
          writeCloseFriends(friendsNow);
          const on = at === -1;
          row.classList.toggle('on', on);
          row.setAttribute('aria-pressed', String(on));
        });
      });
    }
  }

  // Expose the overrides so every call site in main.js resolves to these.
  window.storyMine = storyMine;
  window.storyLatest = storyLatest;
  window.hydrateStoryShelf = hydrateStoryShelf;
  window.hydrateHighlights = hydrateHighlights;
  window.attachCloseFriendsSheet = attachCloseFriendsSheet;

  // Wire the upgraded behavior on the pages that need it (runPage in main.js
  // may already have run by the time this script loads, so re-hydrate here).
  const boot = () => {
    const page = document.body.dataset.page || 'home';
    if (page === 'home') hydrateStoryShelf();
    if (page === 'profile') {
      hydrateHighlights();
      attachCloseFriendsSheet();
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
