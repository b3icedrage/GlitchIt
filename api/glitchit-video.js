// GlitchIt — GET /api/glitchit-video: AI video generation for @glitchit.
//
// The GlitchIt AI creator calls this endpoint once a minute. When a fal.ai
// key is configured the endpoint drives the queue-based Wan-2.1 text-to-video
// pipeline: it starts a new generation when idle, polls any in-flight job on
// each request, and returns the finished clip's hosted URL as soon as it's
// ready (completion is detected on the next poll, so no background workers
// are needed). Clients render the returned video directly in the feed.
//
// When no key is set the endpoint reports { ok:true, ai:false } and the
// client keeps posting its local realistic clips — nothing breaks.
//
// Required env var (Vercel → Project Settings → Environment Variables, or
// the Freebuff Keys / API keys tab, and .env.local for the preview):
//   FAL_KEY - from fal.ai → Settings → API keys (free credits on signup)
'use strict';

const FAL_MODEL = 'fal-ai/wan-t2v';
const FAL_BASE = 'https://queue.fal.ai';
const REQUEST_INTERVAL_MS = 60000; // start a new clip at most once a minute

// Character-driven cinematic prompts (physical people in real scenes).
const PROMPTS = [
  'Cinematic video of a young street dancer performing an energetic hip-hop routine at night in a neon-lit city alley, glowing lights, shallow depth of field, realistic, 4k',
  'A woman in a flowing red dress dancing in front of a colorful graffiti wall on a sunny urban street, film look, realistic lighting, 4k',
  'Close-up of a cheerful young woman dancing at night under a green streetlight, city bokeh background, cinematic, realistic',
  'Group of five friends dancing in a circle on a street basketball court at night, warm street lights, dynamic motion, realistic, 4k',
  'Three friends dancing a choreography on a neighborhood court at night, cinematic film grain, realistic people, 4k',
  'A runner sprinting through a busy city street at golden hour, motion blur, realistic, cinematic, 4k',
  'A skateboarder performing tricks in an urban skatepark at sunset, realistic, cinematic, 4k',
  'Street portrait of a stylish woman walking through a night market, neon signs, cinematic, realistic, 4k',
];
const TITLES = [
  'Neon alley dancer — AI video',
  'Graffiti wall dancer',
  'Night dancer under the green light',
  'The crew at night',
  'Choreography under the lights',
  'Golden-hour runner',
  'Skatepark at sunset',
  'Night market walk',
];

// Module-level state (per warm serverless instance). Generations are started
// on demand and completed on a later poll — no background workers needed.
let pendingId = null;
let latest = null; // { id, url, poster, title, caption, created_at }
let latestTitle = 'AI video';
let lastStart = 0;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function falHeaders() {
  return {
    Authorization: `Key ${process.env.FAL_KEY || ''}`,
    'Content-Type': 'application/json',
  };
}

async function falSubmit(prompt) {
  const r = await fetch(`${FAL_BASE}/${FAL_MODEL}`, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify({ prompt, duration: 5, resolution: '480p' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(data.detail || data.message || `fal submit failed (${r.status})`));
  if (!data.request_id) throw new Error('fal returned no request_id');
  return data.request_id;
}

async function falStatus(id) {
  const r = await fetch(`${FAL_BASE}/${FAL_MODEL}/requests/${id}/status`, { headers: falHeaders() });
  const data = await r.json().catch(() => ({}));
  return String(data.status || '');
}

async function falResult(id) {
  const r = await fetch(`${FAL_BASE}/${FAL_MODEL}/requests/${id}`, { headers: falHeaders() });
  const data = await r.json().catch(() => ({}));
  const video = data.video || {};
  const images = Array.isArray(data.images) ? data.images : [];
  return { url: video.url || '', poster: (images[0] && images[0].url) || video.url || '' };
}

async function handleAi(res) {
  // Complete any in-flight generation first.
  if (pendingId) {
    try {
      const status = await falStatus(pendingId);
      if (status === 'COMPLETED') {
        const out = await falResult(pendingId);
        if (out.url) {
          latest = {
            id: 'glitchit-ai-' + Date.now(),
            url: out.url,
            poster: out.poster,
            title: latestTitle,
            caption: `${latestTitle} #ai #aivideo #cinematic`,
            created_at: Date.now(),
          };
        }
        pendingId = null;
      } else if (status === 'FAILED' || status === 'CANCELLED' || !status) {
        pendingId = null;
      }
    } catch (err) {
      pendingId = null;
    }
  }

  // Start a fresh generation when idle and the previous one is stale
  // (>= 60s old), so @glitchit keeps producing while someone is watching.
  if (!pendingId && (!latest || Date.now() - latest.created_at >= REQUEST_INTERVAL_MS) && Date.now() - lastStart >= REQUEST_INTERVAL_MS) {
    const idx = Math.floor(Math.random() * PROMPTS.length);
    latestTitle = TITLES[idx] || 'AI video';
    try {
      pendingId = await falSubmit(PROMPTS[idx]);
      lastStart = Date.now();
    } catch (err) {
      console.warn('GlitchIt: fal.ai submit failed', err && err.message ? err.message : err);
      json(res, 200, { ok: false, error: 'ai unavailable' });
      return;
    }
  }

  json(res, 200, {
    ok: true,
    ai: true,
    generating: Boolean(pendingId),
    video: latest || null,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  if (!process.env.FAL_KEY) {
    json(res, 200, { ok: true, ai: false });
    return;
  }
  try {
    await handleAi(res);
  } catch (err) {
    console.warn('GlitchIt: AI video endpoint failed', err && err.message ? err.message : err);
    json(res, 200, { ok: false, error: 'ai unavailable' });
  }
};
