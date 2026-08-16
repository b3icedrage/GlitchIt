// GlitchIt — Flutterwave payments (pan-African: cards, mobile money, bank
// transfer, USSD). Client-side standard checkout using the Flutterwave
// Checkout SDK. Only the public key ships to the browser (src/config.js); the
// secret key stays server-side (env var FLUTTERWAVE_SECRET_KEY) for future
// webhook / transaction verification work.
//
// This module wires the shop payments flow:
//   1. Listing form  — "Save draft listing" stores a draft product (name,
//      price, story) in localStorage and renders it into the shop feed.
//   2. Shop feed     — draft products render as .product cards; "Buy now"
//      opens a Flutterwave checkout for the listed price (KES).
import { FLUTTERWAVE_PUBLIC_KEY } from './config.js?v=6';

const SDK_URL = 'https://checkout.flutterwave.com/v3.js';
const LISTINGS_KEY = 'glitchit.shop.listings.v1';

let sdkPromise = null;

// Load the Flutterwave checkout SDK once; resolve when window.FlutterwaveCheckout exists.
function loadSDK() {
  if (window.FlutterwaveCheckout) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => (window.FlutterwaveCheckout ? resolve() : reject(new Error('Flutterwave SDK did not expose window.FlutterwaveCheckout')));
      script.onerror = () => reject(new Error('Could not load the Flutterwave SDK'));
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

// Start a Flutterwave standard checkout. Resolves with the payment data on
// success, rejects when the popup is closed without paying.
// opts: { amount, currency, email, api_ref, title, description }
export function flutterwaveCheckout(opts) {
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('⚠', 'Enter a valid amount to pay.');
    return Promise.reject(new Error('invalid amount'));
  }
  const user = window.GLITCHIT_USER;
  const email = (opts.email || (user && !user.guest && user.email)) || 'guest@glitchit.app';
  const name = (user && !user.guest && (user.user_metadata?.username || user.email?.split('@')[0])) || 'GlitchIt creator';
  const apiRef = opts.api_ref || `glitchit-${Date.now()}`;
  return loadSDK()
    .then(() => new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn) => (data) => {
        if (settled) return;
        settled = true;
        fn(data);
      };
      window.FlutterwaveCheckout({
        public_key: FLUTTERWAVE_PUBLIC_KEY,
        tx_ref: apiRef,
        amount,
        currency: opts.currency || 'KES',
        customer: { email, name },
        customizations: {
          title: opts.title || 'GlitchIt',
          description: opts.description || 'Support a GlitchIt creator',
        },
        callback: settle((data) => {
          toast('✓', 'Payment complete — thanks for supporting GlitchIt!');
          resolve(data);
        }),
        onclose: settle(() => {
          reject(new Error('payment closed'));
        }),
      });
    }))
    .catch((err) => {
      if (err && err.message === 'payment closed') throw err;
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
      flutterwaveCheckout({
        amount: Number(item.price),
        currency: 'KES',
        api_ref: `glitchit-drop-${item.id}`,
        title: item.name,
        description: item.story || `Buy ${item.name} on GlitchIt`,
      });
    });
  });
}

function wireListingForm() {
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

export function attachFlutterwavePayments() {
  if (document.body.dataset.page !== 'shop') return;
  wireListingForm();
  renderShopFeed();
  // Re-render once auth settles — main.js sets window.GLITCHIT_USER
  // asynchronously after boot, which refines the seller name shown on cards.
  setTimeout(renderShopFeed, 800);
}

// Self-attach once the DOM is ready. main.js imports this module early on every
// page, so this runs before the page's interaction handlers are attached.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachFlutterwavePayments, { once: true });
} else {
  attachFlutterwavePayments();
}
