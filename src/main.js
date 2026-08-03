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

const navItems = [['⌂', 'Home'], ['⌕', 'Search'], ['◈', 'Explore'], ['▣', 'Glitches'], ['✉', 'Messages'], ['♡', 'Notifications'], ['＋', 'Create'], ['◒', 'Shop'], ['◎', 'Profile']];
const userUploads = { feed: [], stories: [], videos: [] };
const bottomNavItems = navItems.filter(([, label]) => ['Home', 'Search', 'Glitches', 'Create', 'Shop', 'Profile'].includes(label));

const profile = {
  username: 'b3ice_drage',
  name: 'ßrįæñ',
  avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=240&q=80',
  cover: 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=1000&q=80',
  bio: 'Building a clean photo grid on GlitchIt.',
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

function bottomBar() {
  return `<nav class="bottom-bar" aria-label="Primary mobile navigation">${bottomNavItems.map(navLink).join('')}</nav>`;
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
  return `<section class="profile-panel page" id="profile" data-page="profile" aria-labelledby="profile-title" style="--profile-cover: url('${profile.cover}')"><div class="profile-cover"></div><div class="profile-content"><div class="profile-header"><div class="profile-photo-wrap"><img src="${profile.avatar}" alt="${profile.username} profile photo"><button type="button">Update photo</button></div><div class="profile-summary"><div class="profile-identity"><span class="eyebrow">Profile</span><h2 id="profile-title">${profile.username}</h2><button type="button">Edit profile</button><a class="settings-button" href="#settings">Settings</a></div><div class="profile-metrics">${profile.metrics.map(([value, label]) => `<span><b>${value}</b>${label}</span>`).join('')}</div><strong class="profile-name">${profile.name}</strong><p>${profile.bio}</p></div></div><p class="profile-insights">${profile.insights} <a href="#settings">View insights</a></p><div class="profile-share-empty">${icon('▧')}<h3>Start your photo grid</h3><p>Your shared photos will collect here on your profile.</p><a class="primary-action" href="#create">Share a photo</a></div>${profileSettingsPanel()}</div></section>`;
}



function uploadCard(item, type) {
  const isVideo = type === 'videos' || item.type === 'video';
  if (isVideo) return glitchVideoCard({ ...item, user: profile.username, avatar: profile.avatar, src: item.preview, caption: item.caption || item.title }, true);
  return `<article class="post upload-card"><header><div class="profile"><img src="${profile.avatar}" alt="${profile.username} avatar"><div><strong>${profile.username}</strong><span>Fresh post</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${item.preview}" alt="${item.title}"><span class="shop-badge">${icon('＋')} ${item.type}</span></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>New upload</strong><p><b>${profile.username}</b> ${item.caption || item.title}</p></article>`;
}

function glitchVideoCard(video, uploaded = false) {
  return `<article class="video-card ${uploaded ? 'upload-card' : ''}"><video class="glitch-video" playsinline loop preload="metadata" poster="${video.poster || ''}" src="${video.src}" aria-label="${video.title}"></video><button type="button" class="video-toggle" aria-label="Pause ${video.title}">${icon('Ⅱ')}</button><div class="video-overlay"><div class="profile"><img src="${video.avatar}" alt="${video.user} avatar"><div><strong>${video.user}</strong><span>${video.title}</span></div></div><p>${video.caption}</p><a class="shop-badge" href="#shop">${icon('◒')} Tagged products</a></div></article>`;
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
  simplePage('explore', '◈', 'Explore', 'Discover trending creators, fresh drops, and glitchy inspiration in its own space.', [{ href: '#home', label: 'Back to feed' }]),
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

document.getElementById('app').innerHTML = `${sidebar()}<main><div class="mobile-top"><a class="brand" href="#home">${icon('ϟ')}GlitchIt</a>${icon('◒')}</div>${pages.join('')}</main>${rightRail()}${bottomBar()}`;
attachShopFilters();
attachStoryLinks();
attachThemeToggle();
attachCreateForm();
attachSettingsDrawer();
attachGlitchAutoplay();
route();
updateGlitchPlayback();
window.addEventListener('hashchange', () => {
  route();
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


function getGlitchVideos() {
  return [...document.querySelectorAll('.glitch-video')];
}

function pauseGlitchVideo(video) {
  video.pause();
  video.closest('.video-card')?.querySelector('.video-toggle').replaceChildren(document.createRange().createContextualFragment(icon('▶')));
}

function playGlitchVideo(video) {
  if (video.dataset.userPaused === 'true') return;
  getGlitchVideos().forEach((otherVideo) => {
    if (otherVideo !== video) pauseGlitchVideo(otherVideo);
  });
  video.muted = true;
  video.play().catch(() => pauseGlitchVideo(video));
  video.closest('.video-card')?.querySelector('.video-toggle').replaceChildren(document.createRange().createContextualFragment(icon('Ⅱ')));
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
    video.addEventListener('click', () => {
      video.dataset.userPaused = video.paused ? 'false' : 'true';
      video.paused ? playGlitchVideo(video) : pauseGlitchVideo(video);
    });
    video.closest('.video-card')?.querySelector('.video-toggle')?.addEventListener('click', () => {
      video.dataset.userPaused = video.paused ? 'false' : 'true';
      video.paused ? playGlitchVideo(video) : pauseGlitchVideo(video);
    });
  });
  const reel = document.getElementById('glitches-reel');
  if (reel && !reel.dataset.scrollReady) {
    reel.dataset.scrollReady = 'true';
    reel.addEventListener('scroll', updateGlitchPlayback, { passive: true });
  }
  updateGlitchPlayback();
}

window.addEventListener('scroll', updateGlitchPlayback, { passive: true });
