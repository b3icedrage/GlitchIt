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

const navItems = [['⌂', 'Home'], ['⌕', 'Search'], ['◈', 'Explore'], ['▣', 'Reels'], ['✉', 'Messages'], ['♡', 'Notifications'], ['＋', 'Create'], ['◒', 'Shop'], ['◎', 'Profile'], ['⚙', 'Settings']];
const bottomNavItems = navItems.filter(([, label]) => ['Home', 'Search', 'Create', 'Shop', 'Profile'].includes(label));

const profile = {
  username: 'glitch_founder',
  name: 'GlitchIt Studio',
  avatar: stories[2][1],
  cover: 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=1000&q=80',
  bio: 'Creator tools, limited drops, and social shopping experiments from the GlitchIt team.',
  website: 'glitchit.shop/studio',
  metrics: [['128', 'posts'], ['12.8k', 'followers'], ['46', 'drops']],
  highlights: ['Drops', 'Fits', 'Studio', 'Reviews'],
};

const accountSettings = [
  { group: 'Privacy', title: 'Private profile', description: 'Approve followers before they can see posts and Shop drops.', enabled: false },
  { group: 'Shop', title: 'Seller mode', description: 'Show products, promos, and order stats on your profile.', enabled: true },
  { group: 'Notifications', title: 'Drop alerts', description: 'Notify followers when a new product or post goes live.', enabled: true },
];

function navLink([symbol, label]) {
  return `<a class="${label === 'Shop' ? 'active' : ''}" href="#${label.toLowerCase()}">${icon(symbol)}<span>${label}</span></a>`;
}

function sidebar() {
  return `<aside class="sidebar"><a class="brand" href="#home">${icon('ϟ')}GlitchIt</a><nav>${navItems.map(navLink).join('')}</nav><button class="post-button">Post</button></aside>`;
}

function bottomBar() {
  return `<nav class="bottom-bar" aria-label="Primary mobile navigation">${bottomNavItems.map(navLink).join('')}</nav>`;
}

function storiesMarkup() {
  return `<section class="stories" aria-label="Stories">${stories.map(([name, image, live]) => `<button class="story"><span class="story-ring ${live ? 'live' : ''}"><img src="${image}" alt="${name} avatar"></span><span>${name}</span></button>`).join('')}</section>`;
}

function post([user, avatar, location, image, likes, caption, comments, tags]) {
  return `<article class="post"><header><div class="profile"><img src="${avatar}" alt="${user} avatar"><div><strong>${user}</strong><span>${location}</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${image}" alt="${user} post"><a class="shop-badge" href="#shop">${icon('◒')} ${tags[0]}</a></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>${likes} likes</strong><p><b>${user}</b> ${caption}</p><div class="tag-row"><span>${tags[1]}</span><a href="#shop">View in Shop</a></div><button class="text-button">View all ${comments} comments</button><form class="comment-box"><input aria-label="Add a comment" placeholder="Add a comment..."><button>Post</button></form></article>`;
}

function shop() {
  const featured = products.reduce((least, product) => currencyValue(product[2]) < currencyValue(least[2]) ? product : least, products[0]);
  return `<section class="shop" id="shop"><div class="shop-heading"><div><span class="eyebrow">Creator marketplace</span><h2>Shop fresh drops on GlitchIt</h2><p>Creators can list products, tag them in posts, collect follows, and turn every profile into a storefront.</p></div><a class="primary-action" href="#list-product">List a product</a></div><div class="shop-tools"><label>Search marketplace<input id="shop-search" placeholder="Search products or sellers"></label><label>Category<select id="category-filter"><option value="all">All categories</option>${[...new Set(products.map((product) => product[3]))].map((category) => `<option>${category}</option>`).join('')}</select></label><div class="featured"><span>Best entry price</span><strong>${featured[0]} ${featured[2]}</strong></div></div><div class="product-grid" id="product-grid">${productCards(products)}</div><form class="listing-form" id="list-product"><h3>Market your product</h3><p>Create a storefront-ready listing for the GlitchIt Shop.</p><div><input aria-label="Product name" placeholder="Product name"><input aria-label="Price" placeholder="Price"></div><textarea aria-label="Product story" placeholder="Tell shoppers what makes it special"></textarea><button type="button">Save draft listing</button></form></section>`;
}

function productCards(items) {
  return items.map(([title, seller, price, category, image]) => `<article class="product" data-title="${title.toLowerCase()}" data-seller="${seller.toLowerCase()}" data-category="${category}"><img src="${image}" alt="${title}"><div><span>${category}</span><h3>${title}</h3><p>${seller}</p><strong>${price}</strong><button>Promote</button></div></article>`).join('');
}

function profilePanel() {
  return `<section class="profile-panel" id="profile" style="--profile-cover: url('${profile.cover}')"><div class="profile-cover"></div><div class="profile-content"><div class="profile-header"><img src="${profile.avatar}" alt="${profile.username} profile"><div><span class="eyebrow">Creator profile</span><h2>${profile.username}</h2><strong>${profile.name}</strong><p>${profile.bio}</p><a href="https://${profile.website}">${profile.website}</a></div><button type="button">Edit profile</button></div><div class="profile-metrics">${profile.metrics.map(([value, label]) => `<span><b>${value}</b>${label}</span>`).join('')}</div><div class="highlight-row" aria-label="Profile highlights">${profile.highlights.map((highlight) => `<span>${highlight}</span>`).join('')}</div></div></section>`;
}

function settingsPanel() {
  return `<section class="settings-panel" id="settings"><div class="settings-heading"><span class="eyebrow">Account settings</span><h2>Creator controls</h2><p>Tune profile visibility, storefront behavior, and launch notifications from one dashboard.</p></div><div class="settings-list">${accountSettings.map(({ group, title, description, enabled }) => `<label class="setting-item"><span><small>${group}</small><strong>${title}</strong><em>${description}</em></span><input type="checkbox" ${enabled ? 'checked' : ''} aria-label="${title}"><i aria-hidden="true"></i></label>`).join('')}</div></section>`;
}

function rightRail() {
  return `<aside class="right-rail"><div class="me"><img src="${profile.avatar}" alt="Your profile"><div><strong>${profile.username}</strong><span>Build your vibe</span></div></div><div class="stats"><span><b>12.8k</b> followers</span><span><b>46</b> drops</span></div><h3>Suggested sellers</h3>${products.slice(0, 4).map(([, seller,, category]) => `<div class="seller"><div><strong>${seller}</strong><span>${category}</span></div><button>Follow</button></div>`).join('')}</aside>`;
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

document.getElementById('app').innerHTML = `${sidebar()}<main id="home"><div class="mobile-top"><a class="brand" href="#home">${icon('ϟ')}GlitchIt</a>${icon('◒')}</div>${storiesMarkup()}${feed.map(post).join('')}${profilePanel()}${settingsPanel()}${shop()}</main>${rightRail()}${bottomBar()}`;
attachShopFilters();
