const stories = [
  ['Nova', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80', true],
  ['PixelLab', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80', true],
  ['Ari', 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=200&q=80', false],
  ['Kicks', 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80', true],
  ['Mira', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', false],
  ['Studio', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', true],
];

const feed = [
  ['glitchwear', stories[0][1], 'Downtown drop', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=80', '18,204', 'Neon streetwear capsule goes live tonight in Shop.', 428, ['Shop the hoodie', 'Limited sizes left']],
  ['pixelmakers', stories[1][1], 'Creator studio', 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1000&q=80', '9,816', 'Handmade desk pieces for creators who like a little signal noise.', 119, ['Desk drop', 'Ships this week']],
  ['mira.motion', stories[4][1], 'GlitchIt Reels', 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1000&q=80', '31,552', 'Styling creator-made accessories from the marketplace.', 804, ['Tagged products', 'Tap to browse']],
];

const glitchVideos = [
  { user: 'mira.motion', avatar: stories[4][1], title: 'Marketplace fit check', caption: 'Swipe-worthy styling loops with tagged accessories.', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', poster: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80' },
  { user: 'glitchwear', avatar: stories[0][1], title: 'Neon drop preview', caption: 'A quick look at tonight\'s creator-made hoodie launch.', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', poster: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80' },
  { user: 'pixelmakers', avatar: stories[1][1], title: 'Desk setup loop', caption: 'Creator lamp details made for short-form browsing.', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', poster: 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80' },
];

const products = [
  ['Prism Hoodie', '@glitchwear', '$68', 'Streetwear', 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=600&q=80'],
  ['Signal Sneakers', '@kicksbyte', '$124', 'Footwear', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80'],
  ['Creator Lamp', '@pixelmakers', '$42', 'Home studio', 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80'],
  ['Loop Tote', '@craftloop', '$36', 'Accessories', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=600&q=80'],
  ['Chrome Headphones', '@soundshift', '$89', 'Audio', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'],
  ['Analog Jacket', '@vintagelane', '$96', 'Outerwear', 'https://images.unsplash.com/photo-1520975954732-35dd22299614?auto=format&fit=crop&w=600&q=80'],
];

const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;
const currencyValue = (price) => Number(price.replace('$', ''));

const navItems = [['⌂', 'Home'], ['⌕', 'Search'], ['▣', 'Glitches'], ['✉', 'Messages'], ['♡', 'Notifications'], ['＋', 'Create'], ['◒', 'Shop'], ['◎', 'Profile']];
const userUploads = { feed: [], stories: [], videos: [] };

const profile = {
  username: 'b3ice_drage',
  name: 'ßrįæñ',
  avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=240&q=80',
  metrics: [['0', 'posts'], ['68', 'followers'], ['120', 'following']],
  insights: '0 views in the last 30 days.',
};

const accountSettings = [
  { group: 'Privacy', title: 'Private profile', description: 'Approve followers before they can see posts and Shop drops.', enabled: false },
  { group: 'Shop', title: 'Seller mode', description: 'Show products, promos, and order stats on your profile.', enabled: true },
  { group: 'Notifications', title: 'Drop alerts', description: 'Notify followers when a new product or post goes live.', enabled: true },
];

function navLink([symbol, label]) {
  const page = label.toLowerCase();
  return `<a data-page-link="${page}" href="#${page}">${icon(symbol)}<span>${label}</span></a>`;
}

function sidebar() {
  return `<aside class="sidebar"><a class="brand" href="#home">${icon('ϟ')}GlitchIt</a><nav>${navItems.map(navLink).join('')}</nav><a class="post-button" href="#create">Post</a></aside>`;
}

// Bottom bar with SVG icons for each page, Glitches gets a glowing play SVG
const bottomNavItems = [
  ['Home', `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10"/></svg>`],
  ['Search', `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`],
  ['Messages', `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`],
  ['Glitches', `<svg class="glitch-play-icon" viewBox="0 0 48 48" width="32" height="32">
          <defs>
            <radialGradient id="glow-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#d62976" stop-opacity="0.6"/>
              <stop offset="100%" stop-color="#4f5bd5" stop-opacity="0"/>
            </radialGradient>
            <filter id="glow-filter">
              <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#d62976" flood-opacity="0.8"/>
            </filter>
          </defs>
          <circle cx="24" cy="24" r="22" fill="url(#glow-grad)" class="glow-pulse"/>
          <circle cx="24" cy="24" r="21" fill="#1a1a2e" stroke="#d62976" stroke-width="1.5" filter="url(#glow-filter)"/>
          <polygon points="19,14 19,34 35,24" fill="#fff" filter="url(#glow-filter)"/>
        </svg>`],
  ['Create', `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`],
  ['Shop', `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`],
  ['Profile', `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`],
];

function bottomBar() {
  return `<nav class="bottom-bar" aria-label="Primary mobile navigation">${bottomNavItems.map(([label, svg]) => {
    const page = label.toLowerCase();
    const isGlitches = label === 'Glitches';
    if (isGlitches) {
      return `<a data-page-link="${page}" href="#${page}" class="glitch-nav-btn">${svg}<span>${label}</span></a>`;
    }
    return `<a data-page-link="${page}" href="#${page}">${svg}<span>${label}</span></a>`;
  }).join('')}</nav>`;
}

function storiesMarkup() {
  const allStories = [['Your story', profile.avatar, false, true], ...userUploads.stories.map((story) => [story.title, story.preview, true, false]), ...stories.map((story) => [...story, false])];
  return `<section class="stories" aria-label="Stories">${allStories.map(([name, image, live, create], index) => `<a class="story ${create ? 'story-create' : ''}" href="${create ? '#create' : `#story-${index}`}" ${create ? '' : `data-story-index="${index}"`} aria-label="${create ? 'Create a story' : `Open ${name}'s story`}"><span class="story-ring ${live ? 'live' : ''}"><img src="${image}" alt="${name} avatar">${create ? '<b>＋</b>' : ''}</span><span>${name}</span></a>`).join('')}</section>`;
}

function post([user, avatar, location, image, likes, caption, comments, tags]) {
  return `<article class="post"><header><div class="profile"><img src="${avatar}" alt="${user} avatar"><div><strong>${user}</strong><span>${location}</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${image}" alt="${user} post"><a class="shop-badge" href="#shop">${icon('◒')} ${tags[0]}</a></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>${likes} likes</strong><p><b>${user}</b> ${caption}</p><div class="tag-row"><span>${tags[1]}</span><a href="#shop">View in Shop</a></div><button class="text-button">View all ${comments} comments</button><form class="comment-box"><input aria-label="Add a comment" placeholder="Add a comment..."><button>Post</button></form></article>`;
}

function pageShell(id, title, description, content) {
  return `<section class="page" id="${id}" data-page="${id}" aria-labelledby="${id}-title"><div class="page-intro"><span class="eyebrow">${title}</span><h1 id="${id}-title">${title}</h1><p>${description}</p></div>${content}</section>`;
}

function homePage() {
  return pageShell('home', 'Home feed', 'Catch creator stories, videos, posts, and shoppable moments in one dedicated feed.', `${storiesMarkup()}<div id="upload-feed">${renderUploads('feed')}</div>${feed.map(post).join('')}`);
}

function shop() {
  const featured = products.reduce((least, product) => currencyValue(product[2]) < currencyValue(least[2]) ? product : least, products[0]);
  return `<section class="shop page" id="shop" data-page="shop" aria-labelledby="shop-title"><div class="shop-heading"><div><span class="eyebrow">Creator marketplace</span><h2 id="shop-title">Shop fresh drops on GlitchIt</h2><p>Creators can list products, tag them in posts, collect follows, and turn every profile into a storefront.</p></div><a class="primary-action" href="#list-product">List a product</a></div><div class="shop-tools"><label>Search marketplace<input id="shop-search" placeholder="Search products or sellers"></label><label>Category<select id="category-filter"><option value="all">All categories</option>${[...new Set(products.map((product) => product[3]))].map((category) => `<option>${category}</option>`).join('')}</select></label><div class="featured"><span>Best entry price</span><strong>${featured[0]} ${featured[2]}</strong></div></div><div class="product-grid" id="product-grid">${productCards(products)}</div><form class="listing-form" id="list-product"><h3>Market your product</h3><p>Create a storefront-ready listing for the GlitchIt Shop.</p><div><input aria-label="Product name" placeholder="Product name"><input aria-label="Price" placeholder="Price"></div><textarea aria-label="Product story" placeholder="Tell shoppers what makes it special"></textarea><button type="button">Save draft listing</button></form></section>`;
}

function productCards(items) {
  return items.map(([title, seller, price, category, image]) => `<article class="product" data-title="${title.toLowerCase()}" data-seller="${seller.toLowerCase()}" data-category="${category}"><img src="${image}" alt="${title}"><div><span>${category}</span><h3>${title}</h3><p>${seller}</p><strong>${price}</strong><button>Promote</button></div></article>`).join('');
}

function profileSettingsPanel() {
  const settings = [...accountSettings, { group: 'Theme', title: 'Dark theme', description: 'Switch GlitchIt into a darker high-contrast interface.', enabled: false, theme: true }];
  return `<div class="settings-backdrop"></div><section class="settings-panel profile-settings" id="settings" aria-labelledby="settings-title"><button type="button" class="settings-close" aria-label="Close settings">×</button><div class="settings-heading"><span class="eyebrow">Account settings</span><h2 id="settings-title">Creator controls</h2><p>Tune profile visibility, storefront behavior, launch notifications, and your display theme from profile settings.</p></div><div class="settings-list">${settings.map(({ group, title, description, enabled, theme }) => `<label class="setting-item"><span><small>${group}</small><strong>${title}</strong><em>${description}</em></span><input type="checkbox" ${enabled ? 'checked' : ''} ${theme ? 'id="theme-toggle"' : ''} aria-label="${title}"><i aria-hidden="true"></i></label>`).join('')}</div></section>`;
}

function profilePanel() {
  return `<section class="profile-panel page" id="profile" data-page="profile" aria-labelledby="profile-title"><div class="profile-content"><div class="profile-topbar"><strong>${profile.username}</strong><div class="profile-top-actions">${icon('＋')}${icon('☰')}</div></div><div class="profile-header"><div class="profile-photo-wrap"><img src="${profile.avatar}" alt="${profile.username}'s profile picture"><button type="button">Change profile photo</button></div><div class="profile-summary"><div class="profile-identity"><h2 id="profile-title">${profile.username}</h2><button type="button">Edit profile</button><a class="settings-button" href="#settings">Settings</a></div><div class="profile-metrics">${profile.metrics.map(([value, label]) => `<span><b>${value}</b>${label}</span>`).join('')}</div><strong class="profile-name">${profile.name}</strong></div></div><p class="profile-insights">${profile.insights} <a href="#settings">View insights</a></p><div class="profile-share-empty">${icon('▧')}<h3>Share Photos</h3><p>When you share photos, they will appear on your profile.</p></div>${profileSettingsPanel()}</div></section>`;
}



function uploadCard(item, type) {
  const isVideo = type === 'videos' || item.type === 'video';
  if (isVideo) return glitchVideoCard({ ...item, user: profile.username, avatar: profile.avatar, src: item.preview, caption: item.caption || item.title }, true);
  return `<article class="post upload-card"><header><div class="profile"><img src="${profile.avatar}" alt="${profile.username} avatar"><div><strong>${profile.username}</strong><span>Fresh post</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${item.preview}" alt="${item.title}"><span class="shop-badge">${icon('＋')} ${item.type}</span></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>New upload</strong><p><b>${profile.username}</b> ${item.caption || item.title}</p></article>`;
}

function glitchVideoCard(video, uploaded = false) {
  return `<article class="video-card ${uploaded ? 'upload-card' : ''}"><video class="glitch-video" playsinline loop preload="metadata" poster="${video.poster || ''}" src="${video.src}" aria-label="${video.title}"></video><button type="button" class="video-toggle" aria-label="Pause ${video.title}">${icon('Ⅱ')}</button><button type="button" class="sound-toggle" aria-label="Mute ${video.title}">${icon('🔊')}</button><div class="video-overlay"><div class="profile"><img src="${video.avatar}" alt="${video.user} avatar"><div><strong>${video.user}</strong><span>${video.title}</span></div></div><p>${video.caption}</p><a class="shop-badge" href="#shop">${icon('◒')} Tagged products</a></div></article>`;
}

function renderUploads(type) {
  return userUploads[type].map((item) => uploadCard(item, type)).join('');
}

function glitchesPage() {
  return pageShell('glitches', 'Glitches', 'Swipe through creator videos that autoplay like Reels until you pause or move to the next Glitch.', `<div class="video-grid" id="glitches-reel"><div id="video-feed">${renderUploads('videos')}</div>${glitchVideos.map((video) => glitchVideoCard(video)).join('')}</div><a class="primary-action" href="#create">Post a video</a>`);
}

function createPage() {
  return pageShell('create', 'Create', 'Post to the feed, publish a story, or upload a video Glitch.', `<form class="create-form" id="create-form"><div class="create-options" role="radiogroup" aria-label="Post type"><label><input type="radio" name="post-type" value="feed" checked> Feed post</label><label><input type="radio" name="post-type" value="stories"> Story</label><label><input type="radio" name="post-type" value="videos"> Video</label></div><input name="title" aria-label="Title" placeholder="Title or story headline" required><textarea name="caption" aria-label="Caption" placeholder="Write a caption..."></textarea><label class="file-drop">Choose image or video<input name="media" type="file" accept="image/*,video/*"></label><button type="submit" class="primary-action">Publish</button><p class="create-status" id="create-status" role="status"></p></form>`);
}

function rightRail() {
  return `<aside class="right-rail"><div class="me"><img src="${profile.avatar}" alt="Your profile"><div><strong>${profile.username}</strong><span>Build your vibe</span></div></div><div class="stats"><span><b>12.8k</b> followers</span><span><b>46</b> drops</span></div><h3>Suggested sellers</h3>${products.slice(0, 4).map(([, seller,, category]) => `<div class="seller"><div><strong>${seller}</strong><span>${category}</span></div><button>Follow</button></div>`).join('')}</aside>`;
}

function messagesPage() {
  const threads = [
    ['Nova', 'Sent a preview of tonight\'s neon hoodie drop.', '2m', stories[0][1]],
    ['PixelLab', 'Can you approve the creator lamp collab copy?', '18m', stories[1][1]],
    ['Kicks', 'Your Signal Sneakers order is ready to ship.', '1h', stories[3][1]],
  ];
  return pageShell('messages', 'Messages', 'Keep conversations with sellers, collaborators, and followers separated from the feed.', `<div class="message-list">${threads.map(([name, text, time, image]) => `<a class="message-card" href="#messages"><img src="${image}" alt="${name} avatar"><span><strong>${name}</strong><em>${text}</em></span><small>${time}</small></a>`).join('')}</div>`);
}

function activityPage() {
  const items = [
    ['♡', 'mira.motion liked your storefront launch post.', 'Just now'],
    ['◒', 'Prism Hoodie crossed 50 saved carts.', '24m'],
    ['＋', 'Studio invited you to co-host a Glitch tomorrow.', '2h'],
    ['▣', 'Your tagged product demo is trending in Glitches.', '4h'],
  ];
  return pageShell('notifications', 'Activity', 'Review likes, comments, follows, product alerts, and creator milestones in a dedicated activity center.', `<div class="activity-list">${items.map(([symbol, text, time]) => `<article class="activity-card">${icon(symbol)}<p>${text}<small>${time}</small></p><button type="button">View</button></article>`).join('')}</div>`);
}

function simplePage(id, symbol, title, description, actions = []) {
  return pageShell(id, title, description, `<div class="empty-state">${icon(symbol)}<h2>${title}</h2><p>${description}</p><div>${actions.map((action) => `<a class="primary-action" href="${action.href}">${action.label}</a>`).join('')}</div></div>`);
}

const pages = [
  homePage(),
  simplePage('search', '⌕', 'Search', 'Find creators, products, posts, and tags without leaving a focused page.', [{ href: '#shop', label: 'Browse products' }]),
  glitchesPage(),
  messagesPage(),
  activityPage(),
  createPage(),
  profilePanel(),
  shop(),
];

function route() {
  const target = window.location.hash.replace('#', '') || 'home';
  const targetElement = document.getElementById(target);
  const nestedPage = targetElement?.closest('[data-page]')?.dataset.page;
  const validPage = document.querySelector(`[data-page="${target}"]`) ? target : nestedPage || 'home';
  document.querySelectorAll('[data-page]').forEach((screen) => {
    screen.hidden = screen.dataset.page !== validPage;
  });
  document.querySelectorAll('[data-page-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.pageLink === validPage);
  });
  // Each screen is its own page: always start at the top of the active screen
  document.querySelector('main')?.scrollTo?.(0, 0);
  document.getElementById('glitches-reel')?.scrollTo?.(0, 0);
}

function attachShopFilters() {
  const search = document.getElementById('shop-search');
  const category = document.getElementById('category-filter');
  const cards = [...document.querySelectorAll('.product')];
  const filter = () => {
    const term = search.value.trim().toLowerCase();
    const selected = category.value;
    cards.forEach((card) => {
      const matchesTerm = card.dataset.title.includes(term) || card.dataset.seller.includes(term);
      const matchesCategory = selected === 'all' || card.dataset.category === selected;
      card.hidden = !(matchesTerm && matchesCategory);
    });
  };
  search.addEventListener('input', filter);
  category.addEventListener('change', filter);
}

document.getElementById('app').innerHTML = `${sidebar()}<main><div class="mobile-top"><a class="brand" href="#home">${icon('ϟ')}GlitchIt</a><div class="mobile-top-actions"><a data-page-link="notifications" href="#notifications" class="top-activity-btn" aria-label="Activity">${icon('♡')}</a>${icon('◒')}</div></div>${pages.join('')}</main>${rightRail()}${bottomBar()}`;
attachShopFilters();
attachStoryLinks();
attachThemeToggle();
attachCreateForm();
attachSettingsDrawer();
attachGlitchAutoplay();
attachEndOfPageDetection();
route();
updateGlitchPlayback();
window.addEventListener('hashchange', () => {
  route();
  // Auto-unmute all videos when navigating to Glitches page
  if (!document.getElementById('glitches')?.hidden && !glitchSoundUnmuted) {
    unmuteAllGlitchVideos(true);
  }
  updateGlitchPlayback();
});

function attachStoryLinks() {
  document.querySelectorAll('[data-story-index]').forEach((storyLink) => {
    storyLink.addEventListener('click', (event) => {
      event.preventDefault();
      const allStories = [...userUploads.stories.map((story) => [story.title, story.preview, true]), ...stories];
      const [name, image, live] = allStories[Math.max(0, Number(storyLink.dataset.storyIndex) - 1)];
      document.getElementById('story-viewer')?.remove();
      document.body.insertAdjacentHTML('beforeend', `<div class="story-viewer" id="story-viewer" role="dialog" aria-modal="true" aria-label="${name} story"><button type="button" class="story-close" aria-label="Close story">×</button><div><img src="${image}" alt="${name} story"><span>${live ? 'Live now' : 'Story'}</span><h2>${name}</h2><p>Tap through creator updates, product teasers, and behind-the-scenes moments.</p><a class="primary-action" href="#profile">View profile</a></div></div>`);
      document.querySelector('.story-close').focus();
    });
  });
  document.addEventListener('click', (event) => {
    if (event.target.matches('.story-viewer, .story-close')) document.getElementById('story-viewer')?.remove();
  });
}

function attachCreateForm() {
  const form = document.getElementById('create-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const type = data.get('post-type');
    const file = data.get('media');
    const isVideo = file?.type?.startsWith('video/');
    const fallback = isVideo ? 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' : 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=80';
    const item = { title: data.get('title') || 'Untitled upload', caption: data.get('caption'), preview: file?.size ? URL.createObjectURL(file) : fallback, type: isVideo || type === 'videos' ? 'video' : type };
    userUploads[type].unshift(item);
    document.getElementById('create-status').textContent = `Published to ${type === 'videos' ? 'Glitches video' : type}.`;
    form.reset();
    rebuildDynamicUploads();
  });
}

function rebuildDynamicUploads() {
  const storyShelf = document.querySelector('.stories');
  if (storyShelf) storyShelf.outerHTML = storiesMarkup();
  const feedTarget = document.getElementById('upload-feed');
  if (feedTarget) feedTarget.innerHTML = renderUploads('feed');
  const videoTarget = document.getElementById('video-feed');
  if (videoTarget) videoTarget.innerHTML = renderUploads('videos');
  attachStoryLinks();
  attachGlitchAutoplay();
}

function attachSettingsDrawer() {
  document.querySelectorAll('.settings-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      document.body.classList.toggle('settings-open');
    });
  });
  document.addEventListener('click', (event) => {
    if (document.body.classList.contains('settings-open') && event.target.matches('.settings-backdrop, .settings-close')) document.body.classList.remove('settings-open');
  });
}

function attachThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle?.addEventListener('change', () => {
    document.documentElement.dataset.theme = toggle.checked ? 'dark' : 'light';
  });
}

// End-of-page animated toast: shows "You've seen all updates" for 2s at the bottom of every page
let endToastTimer = null;
let lastEndToastAt = 0;

function showEndOfUpdates() {
  const now = Date.now();
  if (now - lastEndToastAt < 3000) return;
  lastEndToastAt = now;
  let toast = document.getElementById('end-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'end-toast';
    toast.className = 'end-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="end-toast-mark">${icon('ϟ')}</span><span class="end-toast-text">You've seen all updates</span>`;
  toast.classList.remove('show');
  void toast.offsetWidth; // restart the animation
  toast.classList.add('show');
  clearTimeout(endToastTimer);
  endToastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 12;
}

function checkEndOfPage() {
  const activePage = [...document.querySelectorAll('[data-page]')].find((page) => !page.hidden);
  if (!activePage) return;
  const reel = document.getElementById('glitches-reel');
  const mainEl = document.querySelector('main');
  if (activePage.id === 'glitches' && reel && isNearBottom(reel)) {
    showEndOfUpdates();
  } else if (mainEl && isNearBottom(mainEl)) {
    showEndOfUpdates();
  }
}

function attachEndOfPageDetection() {
  document.querySelector('main')?.addEventListener('scroll', checkEndOfPage, { passive: true });
  document.getElementById('glitches-reel')?.addEventListener('scroll', checkEndOfPage, { passive: true });
}


// Global sound state: all videos start unmuted, and toggling sound affects all videos
let glitchSoundUnmuted = true;

function unmuteAllGlitchVideos(unmute) {
  glitchSoundUnmuted = unmute;
  getGlitchVideos().forEach((video) => {
    video.muted = !unmute;
    video.dataset.userUnmuted = unmute ? 'true' : 'false';
    const btn = video.closest('.video-card')?.querySelector('.sound-toggle');
    if (btn) {
      btn.replaceChildren(document.createRange().createContextualFragment(icon(unmute ? '🔊' : '🔇')));
      btn.setAttribute('aria-label', unmute ? `Mute ${video.getAttribute('aria-label') || 'video'}` : `Unmute ${video.getAttribute('aria-label') || 'video'}`);
    }
  });
}

function getGlitchVideos() {
  return [...document.querySelectorAll('.glitch-video')];
}

function pauseGlitchVideo(video) {
  video.pause();
  const card = video.closest('.video-card');
  card?.querySelector('.video-toggle')?.replaceChildren(document.createRange().createContextualFragment(icon('▶')));
}

function playGlitchVideo(video) {
  if (video.dataset.userPaused === 'true') return;
  getGlitchVideos().forEach((otherVideo) => {
    if (otherVideo !== video) pauseGlitchVideo(otherVideo);
  });
  video.play().catch(() => pauseGlitchVideo(video));
  const card = video.closest('.video-card');
  card?.querySelector('.video-toggle')?.replaceChildren(document.createRange().createContextualFragment(icon('Ⅱ')));
}

function updateGlitchPlayback() {
  const glitchesPageVisible = !document.getElementById('glitches')?.hidden;
  if (!glitchesPageVisible) {
    getGlitchVideos().forEach(pauseGlitchVideo);
    return;
  }
  const mostVisible = getGlitchVideos().map((video) => {
    const rect = video.getBoundingClientRect();
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return { video, visible };
  }).filter(({ visible }) => visible > 0).sort((a, b) => b.visible - a.visible)[0]?.video;
  if (mostVisible) playGlitchVideo(mostVisible);
}

function attachGlitchAutoplay() {
  getGlitchVideos().forEach((video) => {
    if (video.dataset.autoplayReady) return;
    video.dataset.autoplayReady = 'true';
    // Sync each new video with the global sound state
    video.muted = !glitchSoundUnmuted;
    video.dataset.userUnmuted = glitchSoundUnmuted ? 'true' : 'false';
    video.addEventListener('click', () => {
      video.dataset.userPaused = video.paused ? 'false' : 'true';
      video.paused ? playGlitchVideo(video) : pauseGlitchVideo(video);
    });
    video.closest('.video-card')?.querySelector('.video-toggle')?.addEventListener('click', () => {
      video.dataset.userPaused = video.paused ? 'false' : 'true';
      video.paused ? playGlitchVideo(video) : pauseGlitchVideo(video);
    });
    // Sound toggle: toggles sound for ALL videos
    const soundBtn = video.closest('.video-card')?.querySelector('.sound-toggle');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unmuteAllGlitchVideos(!glitchSoundUnmuted);
        // Ensure the current video is playing when sound is toggled
        if (video.paused) {
          video.dataset.userPaused = 'false';
          playGlitchVideo(video);
        }
      });
    }
  });
  const reel = document.getElementById('glitches-reel');
  if (reel && !reel.dataset.scrollReady) {
    reel.dataset.scrollReady = 'true';
    reel.addEventListener('scroll', updateGlitchPlayback, { passive: true });
  }
  updateGlitchPlayback();
}

window.addEventListener('scroll', updateGlitchPlayback, { passive: true });