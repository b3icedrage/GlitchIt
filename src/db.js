// GlitchIt — Supabase data layer (client-side, no build step).
// Loaded from main.js via dynamic import. When the config is empty or the
// network fails, every function degrades gracefully (no-op / localStorage)
// so the app keeps working exactly as it did before.
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from './config.js?v=6';

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

// Media blobs are uploaded to Cloudinary (unsigned preset — no secret on the
// page) when it's configured; otherwise we fall back to Supabase Storage.
export function mediaBackend() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET) ? 'cloudinary' : 'supabase';
}
function cloudinaryConfigured() {
  return mediaBackend() === 'cloudinary';
}

// Upload a Blob straight to Cloudinary and return its public CDN URL.
// Free-tier limits: 100 MB per file (unsigned uploads), 25 GB total.
// Exported so the signup onboarding step can reuse it for profile photos.
export async function uploadToCloudinary(blob, kind) {
  const resource = /^video\//i.test(blob.type) ? 'video' : /^image\//i.test(blob.type) ? 'image' : 'auto';
  const ext = (blob.type.split('/')[1] || (kind === 'video' ? 'webm' : 'jpg')).replace(/[^a-z0-9]/gi, '');
  const name = `glitchit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fd = new FormData();
  fd.append('file', blob, name);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('folder', `glitchit/${kind}`);
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/${resource}/upload`, {
      method: 'POST',
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
      const msg = String(data?.error?.message || `Cloudinary upload failed (${res.status})`);
      let reason = 'upload';
      if (/invalid upload preset|unknown preset|not found|invalid cloud/i.test(msg) || res.status === 401 || res.status === 404) reason = 'config';
      else if (/too large|limit|exceed/i.test(msg)) reason = 'size';
      console.warn('GlitchIt: Cloudinary upload failed', data || res.status);
      return { ok: false, reason, detail: msg, size: blob.size || 0 };
    }
    return { ok: true, url: data.secure_url, publicId: data.public_id };
  } catch (err) {
    const msg = String(err?.message || err);
    console.warn('GlitchIt: Cloudinary request failed', err);
    return { ok: false, reason: /failed to fetch|network|timeout|CORS/i.test(msg) ? 'network' : 'upload', detail: msg, size: blob.size || 0 };
  }
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

// Insert a media row, tolerating a missing `verified` column. The app stamps
// it for GlitchIt Verified uploaders so the ⚡ badge renders next to their
// avatar everywhere the row appears, but the Supabase table may not have the
// column created yet — on a column-not-found error the insert retries without
// it, so posting never breaks while the schema catches up.
async function insertMediaRow(sb, row) {
  const { data, error } = await sb.from('media').insert(row).select('id').single();
  if (error && /PGRST204|could not find|does not exist|column/i.test(String(error.message || error))) {
    const stripped = { ...row };
    delete stripped.verified;
    return await sb.from('media').insert(stripped).select('id').single();
  }
  return { data, error };
}

// ---------- media table (videos + images) ----------
export async function saveMedia(item) {
  if (!dbAvailable()) return { ok: false, reason: 'config' };
  try {
    const sb = await getClient();
    if (!sb) return { ok: false, reason: 'network' };
    const kind = item.type === 'video' ? 'video' : (item.kind === 'story' ? 'story' : 'image');
    const owner = item.user || currentOwner;
    if (!owner) return { ok: false, reason: 'auth' };
    let url = item.preview || item.src || item.url || '';
    let poster = item.poster || null;
    const blob = toBlob(item.file) || toBlob(item.preview);
    // Upload anything that isn't already a hosted public URL. Camera photos come
    // in as data: URLs, camera videos as blob: URLs, gallery files as Blobs —
    // every one of those must be pushed to storage so the feed row points at a
    // real, shareable file instead of an empty or throwaway URL.
    if (blob && !/^https?:\/\//i.test(url)) {
      if (cloudinaryConfigured()) {
        const up = await uploadToCloudinary(blob, kind);
        if (!up.ok) return up;
        url = up.url;
      } else {
        // Fallback: Supabase Storage (previous behavior) until Cloudinary is set up.
        const ext = (blob.type.split('/')[1] || (kind === 'video' ? 'webm' : 'jpg')).replace(/[^a-z0-9]/gi, '');
        const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await sb.storage.from('glitchit-media').upload(path, blob, { upsert: false });
        if (upErr) {
          const msg = String(upErr.message || upErr);
          let reason = 'upload';
          if (/not found|does not exist|no such bucket/i.test(msg)) reason = 'bucket';
          else if (/entitytoolarge|413|exceeded the maximum|payload too large|too large/i.test(msg)) reason = 'size';
          console.warn('GlitchIt: media upload failed', upErr);
          return { ok: false, reason, detail: msg, size: blob.size || 0 };
        }
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
      // Note: the real `media` table has no `handle` column — display names are
      // derived from the auth user (see displayUser in main.js), so `handle` is
      // intentionally not written. Do not add it back unless the table changes.
      avatar: item.avatar || '',
      likes: item.likes || 0,
      comments: item.comments || 0,
      shares: item.shares || 0,
      // GlitchIt Verified: stamped when the uploader holds the Pro entitlement,
      // so the ⚡ badge follows their posts and reels everywhere. Skipped
      // gracefully if the column isn't in the media table yet.
      verified: item.verified ? true : false,
    };
    const { data, error } = await insertMediaRow(sb, row);
    if (error) {
      const msg = String(error.message || error);
      const reason = /could not find the table|does not exist|PGRST205/i.test(msg)
        ? 'table'
        : /permission denied|row-level security|policy|PGRST301/i.test(msg)
          ? 'permission'
          : 'error';
      console.warn('GlitchIt: media insert failed', error);
      return { ok: false, reason, detail: msg };
    }
    return { ok: true, id: data.id, url, poster };
  } catch (err) {
    const msg = String(err?.message || err);
    const reason = /could not find the table|does not exist|PGRST205/i.test(msg) ? 'table' : 'error';
    console.warn('GlitchIt: media save failed', err);
    return { ok: false, reason, detail: msg };
  }
}

// Probe the project and report exactly which pieces are missing.
export async function checkSetup() {
  const out = { configured: dbAvailable(), mediaTable: false, savedTable: false, bucket: false, cloudinary: cloudinaryConfigured() };
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

// Every row a user has posted (any kind), newest first — powers the grouped
// Posts/Reels grid on the profile page.
export async function loadOwnMedia(owner, limit = 100) {
  try {
    const sb = await getClient();
    if (!sb || !owner) return [];
    const { data, error } = await sb.from('media').select('*').eq('user', owner).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('GlitchIt: own media load failed', err);
    return [];
  }
}

// Delete one of the signed-in user's media rows. The Cloudinary object itself
// stays (unsigned presets can't destroy assets) — the feed row is what's gone.
export async function deleteMedia(id) {
  if (!id) return { ok: false, reason: 'bad-id' };
  try {
    const sb = await getClient();
    if (!sb) return { ok: false, reason: 'network' };
    const { error } = await sb.from('media').delete().eq('id', id);
    if (error) {
      const msg = String(error.message || error);
      console.warn('GlitchIt: media delete failed', error);
      return { ok: false, reason: /permission denied|row-level security|policy|PGRST301/i.test(msg) ? 'permission' : 'error', detail: msg };
    }
    return { ok: true };
  } catch (err) {
    console.warn('GlitchIt: media delete threw', err);
    return { ok: false, reason: 'error', detail: String(err?.message || err) };
  }
}

// ---------- real creators (distinct users who have posted) ----------
// Derives the list of real accounts from the media table (owner uuid, latest
// handle + avatar) so suggestions and account search never use fake users.
export async function loadCreators(limit = 30) {
  try {
    const sb = await getClient();
    if (!sb) return [];
    // The real `media` table has no `handle` column; consumers fall back to the
    // owner id slice for a display name, so we only select the columns that exist.
    // `verified` is included when available so Verified creators can show a ⚡.
    let rows = null;
    const trySelect = async (cols) => {
      const res = await sb.from('media').select(cols).order('created_at', { ascending: false }).limit(300);
      return res.error ? null : res.data;
    };
    rows = await trySelect('user, avatar, verified');
    if (!rows) rows = await trySelect('user, avatar');
    const seen = new Map();
    (rows || []).forEach((row) => {
      if (!row.user || !/^[0-9a-f-]{8,}$/i.test(String(row.user))) return;
      if (!seen.has(row.user)) seen.set(row.user, { id: row.user, handle: '', avatar: row.avatar || '', verified: Boolean(row.verified) });
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

// Stamp (or clear) the GlitchIt Verified flag on every media row a user has
// posted, so the ⚡ badge appears on their older posts and reels too. Safe to
// call when the `verified` column doesn't exist yet — it just no-ops.
export async function updateMediaVerified(owner, verified = true) {
  if (!owner) return { ok: false, reason: 'bad-owner' };
  try {
    const sb = await getClient();
    if (!sb) return { ok: false, reason: 'network' };
    const { error } = await sb.from('media').update({ verified: Boolean(verified) }).eq('user', owner);
    if (error) {
      console.warn('GlitchIt: updateMediaVerified failed (verified column exists?)', error);
      return { ok: false, reason: 'column' };
    }
    return { ok: true };
  } catch (err) {
    console.warn('GlitchIt: updateMediaVerified threw', err);
    return { ok: false, reason: 'error' };
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
