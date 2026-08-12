// GlitchIt — IntaSend payments (M-Pesa + cards, Kenya).
// Client-side inline checkout using the IntaSend Payment Button SDK. Only the
// publishable key ships to the browser (src/config.js); the secret key stays
// server-side for future webhook / transaction verification work.
//
// This module wires three real flows:
//   1. Shop "Buy" buttons  — product cards in the shop feed open an IntaSend
//      checkout for the listed price (KES).
//   2. Shop listing form   — "Save draft listing" stores a draft product
//      (name, price, story) in localStorage and renders it into the feed.
//   3. Live badge purchase — the "Buy a badge" button on the live page starts
//      a real KES checkout instead of the old placeholder toast.
import { INTASEND_PUBLIC_KEY, INTASEND_LIVE } from './config.js?v=4';

const SDK_URL = 'https://unpkg.com/intasend-inlinejs-sdk@3.0.2/build/intasend-inline.js';
const LISTINGS_KEY = 'glitchit.shop.listings.v1';
const BADGE_AMOUNT_KES = 200;

let sdkPromise = null;

// Load the IntaSend inline SDK once; resolve when window.IntaSend exists.
function loadSDK() {
  if (window.IntaSend) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => (window.IntaSend ? resolve() : reject(new Error('IntaSend SDK did not expose window.IntaSend')));
      script.onerror = () => reject(new Error('Could not load the IntaSend SDK'));
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

// Match the app's existing .end-toast toast style.
function toast(mark, text) {
  const tip = document.createElement('div');
  tip.className = 'end-toast show';
  tip.innerHTML = `<span class="end-toast-mark">${mark}</span><span class="end-toast-text">${text}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2800);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Start an IntaSend checkout. Resolves with the payment results on COMPLETE,
// rejects on FAILED. opts: { amount, currency, email, api_ref, method }
export function intasendCheckout(opts) {
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('⚠', 'Enter a valid amount to pay.');
    return Promise.reject(new Error('invalid amount'));
  }
  const user = window.GLITCHIT_USER;
  const email = (opts.email || (user && !user.guest && user.email)) || '';
  const apiRef = opts.api_ref || `glitchit-${Date.now()}`;
  return loadSDK()
    .then(() => {
      const instance = new window.IntaSend({
        publicAPIKey: INTASEND_PUBLIC_KEY,
        live: INTASEND_LIVE,
      });
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn) => (data) => {
          if (settled) return;
          settled = true;
          fn(data);
        };
        instance
          .on('COMPLETE', settle((data) => {
            toast('✓', 'Payment complete — thanks for supporting GlitchIt!');
            resolve(data);
          }))
          .on('FAILED', settle((data) => {
            toast('✕', 'Payment failed — please try again.');
            reject(data || new Error('payment failed'));
          }))
          .on('IN-PROGRESS', () => {});
        instance.run({
          amount,
          currency: opts.currency || 'KES',
          email,
          api_ref: apiRef,
          ...(opts.method ? { method: opts.method } : {}),
        });
      });
    })
    .catch((err) => {
      toast('✕', 'Could not start payment — check your connection.');
      throw err;
    });
}

// ---------- Shop: draft listings (localStorage) rendered as product cards ----------
function readListings() {
  try {
    const list = JSON.parse(localStorage.getItem(LISTINGS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) { /* storage unavailable */ }
  return [];
}

function saveListings(list) {
  try { localStorage.setItem(LISTINGS_KEY, JSON.stringify(list)); } catch (err) { /* ignore */ }
}

function currentSellerName() {
  const user = window.GLITCHIT_USER;
  return (user && !user.guest && (user.user_metadata?.username || user.email?.split('@')[0])) || 'you';
}

function renderShopFeed() {
  const feed = document.getElementById('shop-feed');
  if (!feed) return;
  feed.querySelectorAll('.product').forEach((el) => el.remove());
  const empty = feed.querySelector('.feed-empty');
  const listings = readListings();
  if (!listings.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  const seller = escapeHtml(currentSellerName());
  feed.insertAdjacentHTML('afterbegin', listings.map((item) => `
    <article class="product" data-title="${escapeHtml(item.name)}" data-seller="${seller}" data-category="drops">
      <div class="product-thumb" aria-hidden="true">${escapeHtml(String(item.name || '?').charAt(0).toUpperCase())}</div>
      <div>
        <h3>${escapeHtml(item.name)}</h3>
        <span>KES ${Number(item.price).toLocaleString()} · ${seller}</span>
        ${item.story ? `<p>${escapeHtml(item.story)}</p>` : ''}
        <button type="button" data-buy-id="${escapeHtml(item.id)}">Buy now</button>
      </div>
    </article>`).join(''));
  feed.querySelectorAll('[data-buy-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = readListings().find((x) => x.id === btn.dataset.buyId);
      if (!item) return;
      intasendCheckout({
        amount: Number(item.price),
        currency: 'KES',
        api_ref: `glitchit-drop-${item.id}`,
      });
    });
  });
}

function wireListingForm() {
  const form = document.getElementById('list-product');
  if (!form) return;
  const name = document.getElementById('listing-name');
  const price = document.getElementById('listing-price');
  const story = document.getElementById('listing-story');
  const saveBtn = document.getElementById('save-listing');
  if (!name || !price || !saveBtn) return;
  saveBtn.addEventListener('click', () => {
    const title = name.value.trim();
    const amount = Number(price.value);
    if (!title) { toast('⚠', 'Give your product a name first.'); name.focus(); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast('⚠', 'Add a valid price in KES.'); price.focus(); return; }
    const list = readListings();
    list.unshift({ id: `p-${Date.now()}`, name: title, price: Math.round(amount), story: story.value.trim(), createdAt: Date.now() });
    saveListings(list);
    name.value = '';
    price.value = '';
    if (story) story.value = '';
    renderShopFeed();
    toast('✓', 'Listing saved — it now appears in the shop feed.');
  });
}

// ---------- Live: real badge checkout (replaces the old placeholder toast) ----------
function wireLiveBadge() {
  const buy = document.getElementById('live-buy');
  if (!buy) return;
  // Capture phase + stopImmediatePropagation so the legacy placeholder handler
  // in main.js never runs (it only showed a fake "purchased" toast).
  buy.addEventListener('click', (event) => {
    event.stopImmediatePropagation();
    intasendCheckout({
      amount: BADGE_AMOUNT_KES,
      currency: 'KES',
      api_ref: `glitchit-live-badge-${Date.now()}`,
    }).catch(() => {});
  }, true);
}

export function attachIntaSendPayments() {
  if (document.body.dataset.page === 'shop') {
    wireListingForm();
    renderShopFeed();
    // Re-render once auth settles — main.js sets window.GLITCHIT_USER
    // asynchronously after boot, which refines the seller name shown on cards.
    setTimeout(renderShopFeed, 800);
  }
  wireLiveBadge();
}

// Self-attach once the DOM is ready. main.js imports this module early on every
// page, so this runs before the page's interaction handlers are attached.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachIntaSendPayments, { once: true });
} else {
  attachIntaSendPayments();
}
