// GlitchIt — shared multi-page app script.
// Every screen lives in its own HTML file (index, search, glitches, messages, activity,
// create, profile, shop). This script detects the current page via <body data-page="...">
// and hydrates only the interactions that page needs. Uploads and theme are persisted
// in localStorage so state carries over when you move between pages.

const icon = (name) => `<span class="icon" aria-hidden="true">${name}</span>`;

const profile = {
  username: 'b3ice_drage',
  name: 'ßrįæñ',
  avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=240&q=80',
};

const page = document.body.dataset.page || 'home';

// ---------- Shared state (persisted across pages) ----------
const UPLOADS_KEY = 'glitchit.uploads.v1';
const THEME_KEY = 'glitchit.theme';
let userUploads = { feed: [], stories: [], videos: [] };
try {
  const saved = JSON.parse(localStorage.getItem(UPLOADS_KEY) || 'null');
  if (saved && saved.feed && saved.stories && saved.videos) userUploads = saved;
} catch (e) { /* corrupted storage — start fresh */ }

function saveUploads() {
  try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(userUploads)); } catch (e) { /* storage unavailable */ }
}

// ---------- Upload cards ----------
function uploadCard(item, type) {
  const isVideo = type === 'videos' || item.type === 'video';
  if (isVideo) return glitchVideoCard({ ...item, user: profile.username, avatar: profile.avatar, src: item.preview, caption: item.caption || item.title }, true);
  return `<article class="post upload-card"><header><div class="profile"><img src="${profile.avatar}" alt="${profile.username} avatar"><div><strong>${profile.username}</strong><span>Fresh post</span></div></div><button class="more">•••</button></header><div class="media-wrap"><img class="post-image" src="${item.preview}" alt="${item.title}"><span class="shop-badge">${icon('＋')} ${item.type}</span></div><div class="actions"><div>${icon('♡')}${icon('◌')}${icon('↗')}</div>${icon('▱')}</div><strong>New upload</strong><p><b>${profile.username}</b> ${item.caption || item.title}</p></article>`;
}

function glitchVideoCard(video, uploaded = false) {
  return `<article class="video-card ${uploaded ? 'upload-card' : ''}"><video class="glitch-video" playsinline loop preload="metadata" poster="${video.poster || ''}" src="${video.src}" aria-label="${video.title}"></video><button type="button" class="video-toggle" aria-label="Pause ${video.title}">${icon('Ⅱ')}</button><button type="button" class="sound-toggle" aria-label="Mute ${video.title}">${icon('🔊')}</button><div class="video-overlay"><div class="profile"><img src="${video.avatar}" alt="${video.user} avatar"><div><strong>${video.user}</strong><span>${video.title}</span></div></div><p>${video.caption}</p><a class="shop-badge" href="shop.html">${icon('◒')} Tagged products</a></div></article>`;
}

function renderUploads(type) {
  return userUploads[type].map((item) => uploadCard(item, type)).join('');
}

// ---------- Stories ----------
function attachStoryLinks() {
  document.querySelectorAll('.story[data-story-name]').forEach((storyLink) => {
    storyLink.addEventListener('click', (event) => {
      event.preventDefault();
      const name = storyLink.dataset.storyName;
      const image = storyLink.dataset.storyImage;
      const live = storyLink.dataset.storyLive === 'true';
      document.getElementById('story-viewer')?.remove();
      document.body.insertAdjacentHTML('beforeend', `<div class="story-viewer" id="story-viewer" role="dialog" aria-modal="true" aria-label="${name} story"><button type="button" class="story-close" aria-label="Close story">×</button><div><img src="${image}" alt="${name} story"><span>${live ? 'Live now' : 'Story'}</span><h2>${name}</h2><p>Tap through creator updates, product teasers, and behind-the-scenes moments.</p><a class="primary-action" href="profile.html">View profile</a></div></div>`);
      document.querySelector('.story-close')?.focus();
    });
  });
  document.addEventListener('click', (event) => {
    if (event.target.matches('.story-viewer, .story-close')) document.getElementById('story-viewer')?.remove();
  });
}

function hydrateStoryShelf() {
  const shelf = document.querySelector('.stories');
  if (!shelf) return;
  const insertPoint = shelf.children[1] || null;
  [...userUploads.stories].reverse().forEach((story) => {
    const link = document.createElement('a');
    link.className = 'story';
    link.href = '#';
    link.dataset.storyName = story.title;
    link.dataset.storyImage = story.preview;
    link.dataset.storyLive = 'true';
    link.setAttribute('aria-label', `Open ${story.title}'s story`);
    link.innerHTML = `<span class="story-ring live"><img src="${story.preview}" alt="${story.title} avatar"></span><span>${story.title}</span>`;
    shelf.insertBefore(link, insertPoint);
  });
  attachStoryLinks();
}

// ---------- Create page ----------
function attachCreateForm() {
  const form = document.getElementById('create-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const type = data.get('post-type');
    const file = data.get('media');
    const isVideo = file?.type?.startsWith('video/');
    const status = document.getElementById('create-status');
    const fallback = isVideo ? 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' : 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=80';
    const publish = (preview) => {
      const item = { title: data.get('title') || 'Untitled upload', caption: data.get('caption'), preview, type: isVideo || type === 'videos' ? 'video' : type };
      userUploads[type].unshift(item);
      saveUploads();
      if (status) {
        const target = type === 'videos' ? 'the Glitches page' : 'the Home feed';
        status.textContent = `Published to ${type === 'videos' ? 'Glitches' : type}. View it on ${target}.`;
      }
      form.reset();
    };
    if (file?.size) {
      const reader = new FileReader();
      reader.onload = () => publish(reader.result);
      reader.onerror = () => publish(fallback);
      reader.readAsDataURL(file);
    } else {
      publish(fallback);
    }
  });
}

// ---------- Profile settings ----------
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
  if (!toggle) return;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.dataset.theme = saved;
  toggle.checked = saved === 'dark';
  toggle.addEventListener('change', () => {
    const theme = toggle.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  });
}

// ---------- Shop page ----------
function attachShopFilters() {
  const search = document.getElementById('shop-search');
  const category = document.getElementById('category-filter');
  if (!search || !category) return;
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
  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    search.value = q;
    filter();
  }
}

// ---------- Search page ----------
function attachSearchForm() {
  const form = document.getElementById('search-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = document.getElementById('search-input').value.trim();
    if (term) location.href = `shop.html?q=${encodeURIComponent(term)}`;
  });
}

// ---------- End-of-page animated toast ----------
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
  const pageSection = document.querySelector('[data-page]');
  if (!pageSection) return;
  const reel = document.getElementById('glitches-reel');
  const mainEl = document.querySelector('main');
  if (pageSection.id === 'glitches' && reel && isNearBottom(reel)) {
    showEndOfUpdates();
  } else if (mainEl && isNearBottom(mainEl)) {
    showEndOfUpdates();
  }
}

function attachEndOfPageDetection() {
  document.querySelector('main')?.addEventListener('scroll', checkEndOfPage, { passive: true });
  document.getElementById('glitches-reel')?.addEventListener('scroll', checkEndOfPage, { passive: true });
}

// ---------- Glitches playback (audio + video autoplay) ----------
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
  const reel = document.getElementById('glitches-reel');
  if (!reel) {
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

// ---------- Page dispatch ----------
attachThemeToggle();
attachEndOfPageDetection();

if (page === 'home') {
  const feedTarget = document.getElementById('upload-feed');
  if (feedTarget) feedTarget.innerHTML = renderUploads('feed');
  hydrateStoryShelf();
}
if (page === 'glitches') {
  const videoTarget = document.getElementById('video-feed');
  if (videoTarget) videoTarget.innerHTML = renderUploads('videos');
  attachGlitchAutoplay();
}
if (page === 'create') attachCreateForm();
if (page === 'profile') attachSettingsDrawer();
if (page === 'shop') attachShopFilters();
if (page === 'search') attachSearchForm();

window.addEventListener('scroll', updateGlitchPlayback, { passive: true });
