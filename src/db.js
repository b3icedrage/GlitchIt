// GlitchIt — Supabase data layer (client-side, no build step).
// Loaded from main.js via dynamic import. When the config is empty or the
// network fails, every function degrades gracefully (no-op / localStorage)
// so the app keeps working exactly as it did before.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SAVED_KEY = 'glitchit.saved.v1';
let client = null;
let clientPromise = null;

export function dbAvailable() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getClient() {
  if (!dbAvailable()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')
      .then((mod) => {
        client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return client;
      })
      .catch((err) => {
        console.warn('GlitchIt: Supabase client failed to load', err);
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
  try {
    const sb = await getClient();
    if (!sb) return { ok: false };
    const kind = item.type === 'video' ? 'video' : 'image';
    let url = item.preview || item.src || item.url || '';
    let poster = item.poster || null;
    const blob = toBlob(item.file) || toBlob(item.preview);
    if (blob && url.startsWith('data:')) {
      const ext = kind === 'video' ? 'mp4' : (blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
      const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await sb.storage.from('glitchit-media').upload(path, blob, { upsert: false });
      if (!upErr) {
        const { data } = sb.storage.from('glitchit-media').getPublicUrl(path);
        url = data.publicUrl;
        if (kind === 'video') poster = url;
      }
    }
    const row = {
      kind,
      title: item.title || 'Untitled',
      caption: item.caption || '',
      url,
      poster,
      user: item.user || 'b3ice_drage',
      avatar: item.avatar || '',
      likes: item.likes || 0,
      comments: item.comments || 0,
      shares: item.shares || 0,
    };
    const { data, error } = await sb.from('media').insert(row).select('id').single();
    if (error) throw error;
    return { ok: true, id: data.id };
  } catch (err) {
    console.warn('GlitchIt: media save failed (table/bucket created?)', err);
    return { ok: false };
  }
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
    if (!sb) return { ok: false };
    const row = {
      media_id: isUuid(video.id) ? video.id : null,
      url: video.src || video.url,
      poster: video.poster,
      title: video.title,
      user: video.user || 'b3ice_drage',
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
    const { error } = await sb.from('saved').delete().eq('url', url);
    if (error) throw error;
  } catch (err) {
    console.warn('GlitchIt: unsave failed', err);
  }
}

export async function loadSaved() {
  const merged = [...localSaved()];
  try {
    const sb = await getClient();
    if (sb) {
      const { data, error } = await sb.from('saved').select('*').order('created_at', { ascending: false });
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
