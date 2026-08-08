// GlitchIt — Vercel serverless music search proxy for GET /api/music.
// Vercel does not run server.js, so this mirrors its music endpoint: browsers
// cannot call Deezer/Apple Music directly (no CORS headers on those APIs), so
// the note-composer music sheet calls this same-origin function instead.
//   GET /api/music?q=...    -> merged Deezer + iTunes search results
//   GET /api/music?chart=1  -> Deezer global top chart (Trending tab)
'use strict';

const TIMEOUT_MS = 8 * 1000;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GlitchIt/1.0' } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function fromDeezer(t, source) {
  return {
    title: t.title || 'Unknown track',
    artist: (t.artist && t.artist.name) || 'Unknown artist',
    genre: source,
    url: t.preview || null,
    art: (t.album && (t.album.cover_medium || t.album.cover_small)) || '',
    source,
    duration: typeof t.duration === 'number' ? t.duration : 0,
    explicit: Boolean(t.explicit_lyrics)
  };
}

function fromItunes(r) {
  return {
    title: r.trackName || 'Unknown track',
    artist: r.artistName || 'Unknown artist',
    genre: r.primaryGenreName || 'Music',
    url: r.previewUrl || null,
    art: r.artworkUrl100 || '',
    source: 'Apple Music',
    duration: typeof r.trackTimeMillis === 'number' ? Math.round(r.trackTimeMillis / 1000) : 0,
    explicit: r.trackExplicitness === 'explicit'
  };
}

async function searchTracks(query) {
  const q = encodeURIComponent(query);
  const [dz, ap] = await Promise.allSettled([
    fetchJson(`https://api.deezer.com/search?q=${q}&limit=25`),
    fetchJson(`https://itunes.apple.com/search?media=music&limit=25&term=${q}`)
  ]);
  const tracks = [];
  if (dz.status === 'fulfilled') {
    (dz.value.data || []).filter((t) => t.preview).forEach((t) => tracks.push(fromDeezer(t, 'Deezer')));
  }
  if (ap.status === 'fulfilled') {
    (ap.value.results || []).filter((r) => r.previewUrl).forEach((r) => tracks.push(fromItunes(r)));
  }
  const seen = new Set();
  return tracks.filter((t) => {
    const key = `${t.title}|${t.artist}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

async function chartTracks() {
  const data = await fetchJson('https://api.deezer.com/chart/0/tracks?limit=20');
  return (data.data || []).filter((t) => t.preview).map((t) => fromDeezer(t, 'Trending'));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const chart = url.searchParams.get('chart') === '1';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (!chart && !q) {
    res.status(400).json({ ok: false, error: 'A q query parameter is required (or chart=1).' });
    return;
  }
  try {
    const tracks = chart ? await chartTracks() : await searchTracks(q);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, tracks });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Music search is unavailable right now — try again in a moment.' });
  }
};
