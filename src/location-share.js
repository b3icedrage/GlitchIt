// GlitchIt — location sharing for chat (Leaflet + OpenStreetMap, no API key).
// Loaded dynamically by src/social-wire.js on chat.html.
//
// Exports:
//   openLocationPicker()     -> Promise<{lat, lng, label}>  (resolves on Send,
//                              rejects when the user closes the sheet)
//   locationCardHtml(message)-> HTML for a location message bubble card
//   hydrateLocationCards(root)-> initialize the Leaflet mini-maps inside any
//                              .msg-loc-map[data-lat] cards under `root`.
//
// Leaflet + OSM tiles are free and keyless; the SDK + CSS are lazy-loaded from
// unpkg only when the picker is opened (or a location card first renders), so
// regular pages never pay for it.

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const DEFAULT_CENTER = [-1.2921, 36.8219]; // Nairobi — the app's primary market

let sdkPromise = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Drop-in replacement for Leaflet's default marker (avoids the classic
// missing-icon bug when Leaflet is served from a CDN) — a themed pin.
function pinIcon() {
  const pin = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#d62976" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="#ffffff"/><circle cx="12" cy="10" r="3.2" fill="#d62976" stroke="none"/></svg>';
  return window.L.divIcon({
    className: 'loc-pin',
    html: pin,
    iconSize: [28, 28],
    iconAnchor: [14, 26],
  });
}

function loadSDK() {
  if (window.L) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[href="' + LEAFLET_CSS + '"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_CSS;
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.async = true;
      script.onload = () => (window.L ? resolve() : reject(new Error('Leaflet did not load')));
      script.onerror = () => reject(new Error('Could not load Leaflet'));
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

// "Nairobi, Nairobi County, Kenya" -> "Nairobi, Kenya" style short label.
function shorten(name) {
  const parts = String(name || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  return `${parts[0]}, ${parts[parts.length - 1]}`;
}

// ---------- Location picker modal ----------
export function openLocationPicker() {
  return loadSDK().then(() => new Promise((resolve, reject) => {
    const modal = document.createElement('div');
    modal.className = 'loc-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Share your location');
    modal.innerHTML = `
      <div class="loc-map" aria-label="Map — tap to drop a pin"></div>
      <button type="button" class="loc-close" aria-label="Close">‹</button>
      <div class="loc-sheet">
        <div class="loc-handle" aria-hidden="true"></div>
        <div class="loc-search-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input class="loc-search" type="search" placeholder="Search for a place…" autocomplete="off" aria-label="Search for a place" />
        </div>
        <div class="loc-row">
          <span class="loc-row-ico" aria-hidden="true">📍</span>
          <span class="loc-row-meta"><strong>My location</strong><em>Use your device's GPS</em></span>
          <button type="button" class="loc-myloc">Locate</button>
        </div>
        <div class="loc-foot">
          <div class="loc-label">Tap the map to drop a pin</div>
          <button type="button" class="loc-send" disabled>Send location</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const mapEl = modal.querySelector('.loc-map');
    const search = modal.querySelector('.loc-search');
    const labelEl = modal.querySelector('.loc-label');
    const sendBtn = modal.querySelector('.loc-send');
    const myLocBtn = modal.querySelector('.loc-myloc');

    let map = null;
    let marker = null;
    let chosen = null;
    let searching = false;
    let closing = false;

    const setLabel = (text) => { labelEl.textContent = text || 'Tap the map to drop a pin'; };

    const reverseGeocode = (lat, lng) => {
      const key = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      chosen = { lat, lng, label: key };
      setLabel('Getting the place name…');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          clearTimeout(timer);
          if (chosen && data && data.display_name) {
            chosen.label = shorten(data.display_name);
            setLabel(chosen.label);
          }
        })
        .catch(() => {
          clearTimeout(timer);
          if (chosen) setLabel(chosen.label);
        });
    };

    const placeMarker = (lat, lng, opts) => {
      const ll = window.L.latLng(lat, lng);
      if (!marker) marker = window.L.marker(ll, { icon: pinIcon(), draggable: true }).addTo(map);
      else marker.setLatLng(ll);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        reverseGeocode(p.lat, p.lng);
      });
      map.setView(ll, Math.max(map.getZoom() || 13, 14), { animate: opts && opts.animate === false ? false : true });
      reverseGeocode(lat, lng);
      sendBtn.disabled = false;
    };

    const close = (value) => {
      if (closing) return;
      closing = true;
      modal.remove();
      if (value) resolve(value);
      else reject(new Error('picker closed'));
    };

    map = window.L.map(mapEl, { scrollWheelZoom: true }).setView(DEFAULT_CENTER, 13);
    window.L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    map.on('click', (e) => placeMarker(e.latlng.lat, e.latlng.lng));
    window.setTimeout(() => map.invalidateSize(), 0);

    // Auto-center on the user's device location (best-effort; otherwise the
    // default city is shown and they can tap/search).
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => placeMarker(pos.coords.latitude, pos.coords.longitude, { animate: false }),
        () => { /* denied/unavailable — user can tap or search */ },
        { timeout: 6000, maximumAge: 30000 }
      );
    }

    modal.querySelector('.loc-close').addEventListener('click', () => close(null));
    sendBtn.addEventListener('click', () => {
      if (!chosen) { setLabel('Tap the map to drop a pin first'); return; }
      sendBtn.disabled = true;
      close({ ...chosen });
    });
    myLocBtn.addEventListener('click', () => {
      if (!navigator.geolocation) { setLabel('Location isn’t available on this device'); return; }
      myLocBtn.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          myLocBtn.textContent = 'Use my location';
          placeMarker(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          myLocBtn.textContent = 'Use my location';
          setLabel('Couldn’t get your location — tap the map instead');
        },
        { timeout: 8000, maximumAge: 0, enableHighAccuracy: true }
      );
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    function doSearch() {
      const q = search.value.trim();
      if (!q || searching) return;
      searching = true;
      search.disabled = true;
      setLabel('Searching…');
      fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => {
          if (rows && rows[0]) {
            const hit = rows[0];
            chosen = { lat: Number(hit.lat), lng: Number(hit.lon), label: shorten(hit.display_name) };
            setLabel(chosen.label);
            placeMarker(chosen.lat, chosen.lng);
          } else {
            setLabel('No place found — try another search');
          }
        })
        .catch(() => { setLabel('Search unavailable — tap the map instead'); })
        .finally(() => { searching = false; search.disabled = false; search.focus(); });
    }
  }));
}

// ---------- Location message cards ----------
// Pure markup — no SDK required to build the HTML (the map div is hydrated
// later by hydrateLocationCards once Leaflet is available).
export function locationCardHtml(m) {
  const lat = Number(m.lat);
  const lng = Number(m.lng);
  const label = m.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  return `
    <div class="msg-loc-card">
      <div class="msg-loc-map" data-lat="${lat}" data-lng="${lng}" role="img" aria-label="Map showing ${escapeHtml(label)}"></div>
      <div class="msg-loc-meta">
        <strong>📍 ${escapeHtml(label)}</strong>
        <a href="${mapsUrl}" target="_blank" rel="noopener">Open in Maps ↗</a>
      </div>
    </div>`;
}

export function hydrateLocationCards(root) {
  if (!root || !window.L) return;
  const els = Array.from(root.querySelectorAll('.msg-loc-map[data-lat]'));
  els.forEach((el) => {
    if (el.classList.contains('leaflet-container')) return; // already hydrated
    const lat = Number(el.dataset.lat);
    const lng = Number(el.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const map = window.L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 14);
    window.L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    window.L.marker([lat, lng], { icon: pinIcon() }).addTo(map);
  });
}
