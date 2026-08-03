const stories = [
  ['Nova', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'],
  ['PixelLab', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80'],
  ['Ari', 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=200&q=80'],
  ['Kicks', 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80'],
  ['Mira', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'],
  ['Studio', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80'],
];

const feed = [
  ['glitchwear', stories[0][1], 'Downtown drop', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=80', '18,204', 'Neon streetwear capsule goes live tonight in Shop.', 428],
  ['pixelmakers', stories[1][1], 'Creator studio', 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1000&q=80', '9,816', 'Handmade desk pieces for creators who like a little signal noise.', 119],
];

const products = [
  ['Prism Hoodie', '@glitchwear', '$68', 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=600&q=80'],
  ['Signal Sneakers', '@kicksbyte', '$124', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80'],
  ['Creator Lamp', '@pixelmakers', '$42', 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80'],
  ['Loop Tote', '@craftloop', '$36', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=600&q=80'],
];

const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;

function sidebar() {
  const items = [['⌂', 'Home'], ['⌕', 'Search'], ['◈', 'Explore'], ['▣', 'Reels'], ['✉', 'Messages'], ['♡', 'Notifications'], ['＋', 'Create'], ['◒', 'Shop'], ['◎', 'Profile']];
  return `<aside class="sidebar"><div class="brand">${icon('ϟ')}GlitchIt</div><nav>${items.map(([symbol, label]) => `<a class="${label === 'Shop' ? 'active' : ''}" href="#${label.toLowerCase()}">${icon(symbol)}<span>${label}</span></a>`).join('')}</nav></aside>`;
}

function storiesMarkup() {
  return `<section class="stories" aria-label="Stories">${stories.map(([name, image]) => `<div class="story"><img src="${image}" alt="${name} avatar"><span>${name}</span></div>`).join('')}</section>`;
}

function post([user, avatar, location, image, likes, caption, comments]) {
  return `<article class="post"><header><div class="profile"><img src="${avatar}" alt=""><div><strong>${user}</strong><span>${location}</span></div></div>${icon('✦')}</header><img class="post-image" src="${image}" alt="${user} post"><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>${likes} likes</strong><p><b>${user}</b> ${caption}</p><button class="text-button">View all ${comments} comments</button></article>`;
}

function shop() {
  return `<section class="shop" id="shop"><div class="shop-heading"><div><span class="eyebrow">Creator marketplace</span><h2>Shop fresh drops on GlitchIt</h2><p>Users can list products, tell their story, and turn every post into a storefront.</p></div><button>List a product</button></div><div class="product-grid">${products.map(([title, seller, price, image]) => `<article class="product"><img src="${image}" alt="${title}"><div><h3>${title}</h3><span>${seller}</span><strong>${price}</strong></div></article>`).join('')}</div></section>`;
}

function rightRail() {
  return `<aside class="right-rail"><div class="me"><img src="${stories[2][1]}" alt="Your profile"><div><strong>glitch_founder</strong><span>Build your vibe</span></div></div><h3>Suggested sellers</h3>${products.slice(0, 3).map(([, seller]) => `<div class="seller"><span>${seller}</span><button>Follow</button></div>`).join('')}</aside>`;
}

document.getElementById('app').innerHTML = `${sidebar()}<main><div class="mobile-top"><div class="brand">${icon('ϟ')}GlitchIt</div>${icon('◒')}</div>${storiesMarkup()}${feed.map(post).join('')}${shop()}</main>${rightRail()}`;
