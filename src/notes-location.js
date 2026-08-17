// GlitchIt — location sharing from the notes shelf.
// Classic enhancement script loaded AFTER main.js on pages with a notes
// shelf (messages.html, index.html). main.js owns the notes state and
// rendering; this script layers the 📍 Map button and location-note cards
// on top by wrapping the global note functions (renderNoteShelves and
// openNoteViewer), so every future re-render keeps the additions.

(function () {
  'use strict';

  const LOC_JS = './location-share.js?v=2';

  const isLocNote = (n) => n && n.kind === 'location' && Number.isFinite(Number(n.lat)) && Number.isFinite(Number(n.lng));

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function locCardHtml(note) {
    const lat = Number(note.lat);
    const lng = Number(note.lng);
    const label = note.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return `<div class="msg-loc-card"><div class="msg-loc-map" data-lat="${lat}" data-lng="${lng}" role="img" aria-label="Map showing ${escapeHtml(label)}"></div><div class="msg-loc-meta"><strong>📍 ${escapeHtml(label)}</strong><a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Open in Maps ↗</a></div></div>`;
  }

  // Open the map picker and post the chosen spot as a location note.
  function shareLocationNote() {
    import(LOC_JS)
      .then((mod) => mod.openLocationPicker())
      .then((loc) => {
        if (!loc) return;
        userNotes.unshift({
          id: Date.now(),
          author: profile.username,
          avatar: profile.avatar,
          text: `📍 ${loc.label}`,
          kind: 'location',
          lat: loc.lat,
          lng: loc.lng,
          label: loc.label,
          music: null,
          createdAt: Date.now()
        });
        saveNotes();
        renderNoteShelves();
        glitchToast('Location note shared 📍');
      })
      .catch(() => { /* picker dismissed */ });
  }

  // Decorate a rendered shelf: put the 📍 Map bubble right beside the ＋ Note
  // bubble and restyle location notes with a pin ring + place label.
  function decorateShelf(shelf) {
    const addBtn = shelf.querySelector('.note-add');
    if (addBtn && !shelf.querySelector('.note-map')) {
      const mapBtn = document.createElement('button');
      mapBtn.type = 'button';
      mapBtn.className = 'note-bubble note-map';
      mapBtn.setAttribute('aria-label', 'Share your location');
      mapBtn.innerHTML = '<span class="note-ring"><b>📍</b></span><span class="note-label">Map</span>';
      addBtn.after(mapBtn);
      mapBtn.addEventListener('click', shareLocationNote);
    }
    shelf.querySelectorAll('[data-note-index]').forEach((b) => {
      const note = userNotes[Number(b.dataset.noteIndex)];
      if (!isLocNote(note)) return;
      const ring = b.querySelector('.note-ring');
      if (ring) ring.innerHTML = '<b>📍</b>';
      const label = b.querySelector('.note-label');
      if (label) label.textContent = `📍 ${String(note.label || '').slice(0, 14)}`;
    });
  }

  const origRender = window.renderNoteShelves;
  window.renderNoteShelves = function () {
    const result = origRender ? origRender() : undefined;
    document.querySelectorAll('.notes-shelf').forEach(decorateShelf);
    return result;
  };

  const origOpen = window.openNoteViewer;
  window.openNoteViewer = function (index) {
    const result = origOpen ? origOpen(index) : undefined;
    const card = document.querySelector('#note-viewer .note-viewer-card');
    const note = userNotes[index];
    if (card && note) {
      const old = card.querySelector('.note-viewer-loc');
      if (old) old.remove();
      if (isLocNote(note)) {
        const box = document.createElement('div');
        box.className = 'note-viewer-loc';
        box.innerHTML = locCardHtml(note);
        const musicRow = document.getElementById('viewer-music');
        if (musicRow) card.insertBefore(box, musicRow);
        else card.appendChild(box);
        import(LOC_JS).then((mod) => mod.hydrateLocationCards(box)).catch(() => {});
      }
    }
    return result;
  };

  // Bootstrap: main.js may have already rendered the shelves by the time this
  // script runs — re-render so the Map button appears on first paint.
  if (typeof renderNoteShelves === 'function') window.renderNoteShelves();
})();
