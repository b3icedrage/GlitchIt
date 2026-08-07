// GlitchIt — Supabase data layer (client-side, no build step).
// Loaded from main.js via dynamic import. When the config is empty or the
// network fails, every function degrades gracefully (no-op / localStorage)
// so the app keeps working exactly as it did before.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=3';

const SAVED_KEY = 'glitchit.saved.v1';
let client = null;
let clientPromise = null;
// Ownership is keyed to the signed-in user's auth UUID (never a spoofable handle).
let currentOwner = '';

// Try several CDNs so one blocked/unreachable mirror (ad-blocker, region, etc.)
// doesn't take down the data layer. First one that loads wins.
// Note: the bare jsDelivr URL serves a UMD build (no ESM exports), so we use
// the /+esm variant — import() needs named exports like createClient.
const SUPABASE_CDNS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2',
  'https://unpkg.com/@supabase/supabase-js@2?module',
  'https://cdn.skypack.dev/@supabase/supabase-js@2',
];

async function importSupabase() {
  let lastErr = null;
  for (const url of SUPABASE_CDNS) {
    try {
      return await import(url);
    } catch (err) {
      lastErr = err;
      console.warn(`GlitchIt: supabase-js unavailable from ${url}`, err);
    }
  }
  throw lastErr || new Error('All Supabase CDNs unreachable');
}

// Accept { id, username } (the signed-in Supabase user) so ownership = UUID.
export function setCurrentUser(user) {
  if (user && typeof user === 'object') {
    currentOwner = user.id || '';
  } else {
    currentOwner = user || '';
  }
}

export function dbAvailable() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getClient() {
  if (!dbAvailable()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = importSupabase()
      .then((mod) => {
        client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return client;
      })
      .catch((err) => {
        console.warn('GlitchIt: Supabase client failed to load from all CDNs', err);
        clientPromise = null;
        return null;
      });
  }
  return clientPromise;
}

// Convert a data URL (or pass through a Blob/File) into an uploadable Blob.
function toBlob(value) {
  if (value instanceof Blob) return value;
  if (typeof value === 'string' && value.startsWith('data:')) {
    try {
      const [head, body] = value.split(',');
      const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch (e) {
      return null;
    }
  }
  return null;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------- media table (videos + images) ----------
export async function saveMedia(item) {
  if (!dbAvailable()) return { ok: false, reason: 'config' };
  try {
    const sb = await getClient();
    if (!sb) return { ok: false, reason: 'network' };
    const kind = item.type === 'video' ? 'video' : 'image';
    const owner = item.user || currentOwner;
    if (!owner) return { ok: false, reason: 'auth' };
    let url = item.preview || item.src || item.url || '';
    let poster = item.poster || null;
    const blob = toBlob(item.file) || toBlob(item.preview);
    if (blob && url.startsWith('data:')) {
      const ext = (blob.type.split('/')[1] || (kind === 'video' ? 'webm' : 'jpg')).replace(/[^a-z0-9]/gi, '');
      const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await sb.storage.from('glitchit-media').upload(path, blob, { upsert: false });
      if (!upErr) {
        const { data } = sb.storage.from('glitchit-media').getPublicUrl(path);
        url = data.publicUrl;
      }
    }
    const row = {
      kind,
      title: item.title || 'Untitled',
      caption: item.caption || '',
      url,
      poster,
      user: owner,
      handle: item.handle || '',
      avatar: item.avatar || '',
      likes: item.likes || 0,
      comments: item.comments || 0,
      shares: item.shares || 0,
    };
    const { data, error } = await sb.from('media').insert(row).select('id').single();
    if (error) throw new Error(error.message || 'insert failed');
    return { ok: true, id: data.id, url, poster };
  } catch (err) {
    const msg = String(err?.message || err);
    const reason = /could not find the table|does not exist|PGRST205/i.test(msg) ? 'table' : 'error';
    console.warn('GlitchIt: media save failed', err);
    return { ok: false, reason };
  }
}

// Probe the project and report exactly which pieces are missing.
export async function checkSetup() {
  const out = { configured: dbAvailable(), mediaTable: false, savedTable: false, bucket: false };
  if (!out.configured) return out;
  try {
    const sb = await getClient();
    if (!sb) return out;
    const [m, s, b] = await Promise.allSettled([
      sb.from('media').select('id').limit(1),
      sb.from('saved').select('id').limit(1),
      sb.storage.from('glitchit-media').list('', { limit: 1 }),
    ]);
    out.mediaTable = m.status === 'fulfilled' && !m.value.error;
    out.savedTable = s.status === 'fulfilled' && !s.value.error;
    out.bucket = b.status === 'fulfilled' && !b.value.error;
  } catch (e) { /* stays false */ }
  return out;
}

export async function loadMedia(kind, limit = 50) {
  try {
    const sb = await getClient();
    if (!sb) return [];
    let q = sb.from('media').select('*').order('created_at', { ascending: false }).limit(limit);
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('GlitchIt: media load failed', err);
    return [];
  }
}

// ---------- real creators (distinct users who have posted) ----------
// Derives the list of real accounts from the media table (owner uuid, latest
// handle + avatar) so suggestions and account search never use fake users.
export async function loadCreators(limit = 30) {
  try {
    const sb = await getClient();
    if (!sb) return [];
    const { data, error } = await sb.from('media').select('user, handle, avatar').order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    const seen = new Map();
    (data || []).forEach((row) => {
      if (!row.user || !/^[0-9a-f-]{8,}$/i.test(String(row.user))) return;
      if (!seen.has(row.user)) seen.set(row.user, { id: row.user, handle: row.handle || '', avatar: row.avatar || '' });
    });
    return [...seen.values()].slice(0, limit);
  } catch (err) {
    console.warn('GlitchIt: creators load failed', err);
    return [];
  }
}

export async function countMedia(owner) {
  if (!owner) return 0;
  try {
    const sb = await getClient();
    if (!sb) return 0;
    const { count, error } = await sb.from('media').select('id', { count: 'exact', head: true }).eq('user', owner);
    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.warn('GlitchIt: media count failed', err);
    return 0;
  }
}

// ---------- saved videos (cloud table + localStorage mirror) ----------
function localSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch (e) { return []; }
}
function writeLocalSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

export async function saveVideo(video) {
  const local = localSaved();
  const already = local.some((s) => s.url === (video.src || video.url));
  if (!already) {
    local.unshift({
      id: video.id || String(Date.now()),
      url: video.src || video.url,
      poster: video.poster,
      title: video.title,
      caption: video.caption,
      user: video.user,
      avatar: video.avatar,
      savedAt: Date.now(),
    });
    writeLocalSaved(local);
  }
  try {
    const sb = await getClient();
    if (!sb || !currentOwner) return { ok: false }; // local mirror only when signed out
    const row = {
      media_id: isUuid(video.id) ? video.id : null,
      url: video.src || video.url,
      poster: video.poster,
      title: video.title,
      user: currentOwner,
    };
    const { error } = await sb.from('saved').insert(row);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.warn('GlitchIt: save failed (saved table created?)', err);
    return { ok: false };
  }
}

export async function unsaveVideo(video) {
  const url = video.src || video.url;
  writeLocalSaved(localSaved().filter((s) => s.url !== url));
  try {
    const sb = await getClient();
    if (!sb) return;
    let q = sb.from('saved').delete().eq('url', url);
    if (currentOwner) q = q.eq('user', currentOwner);
    const { error } = await q;
    if (error) throw error;
  } catch (err) {
    console.warn('GlitchIt: unsave failed', err);
  }
}

export async function loadSaved() {
  const merged = [...localSaved()];
  try {
    const sb = await getClient();
    // Guests (no owner UUID) never see other users' saved rows — local mirror only.
    if (sb && currentOwner) {
      const { data, error } = await sb.from('saved').select('*').order('created_at', { ascending: false }).eq('user', currentOwner);
      if (!error && data && data.length) {
        data.forEach((row) => {
          if (!merged.some((s) => s.url === row.url)) {
            merged.push({
              id: row.id,
              url: row.url || row.poster,
              poster: row.poster,
              title: row.title,
              user: row.user,
              avatar: '',
              savedAt: Date.now(),
            });
          }
        });
      }
    }
  } catch (err) {
    /* keep the local mirror */
  }
  return merged;
}
