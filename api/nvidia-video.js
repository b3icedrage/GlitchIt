// GlitchIt — NVIDIA video generation proxy (ai-glitch tool on the camera page).
// NVIDIA's hosted API (build.nvidia.com) is OpenAI-compatible and uses the
// exact same NVIDIA_API_KEY as the AI assistant (api/chat.js). Video jobs are
// asynchronous: POST creates the generation and returns an id, then GET polls
// that id until the video is ready.
//
//   POST /api/nvidia-video  { prompt, model?, image? }  -> { ok, id, status }
//   GET  /api/nvidia-video?id=<id>                      -> { ok, status, videoUrl? }
//
// The API key is read from the environment server-side only and never shipped
// to the browser. Zero dependencies — plain fetch, matching api/chat.js.
// Required env var (Keys tab / .env.local):
//   NVIDIA_API_KEY
'use strict';

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'nvidia/veo-3.1';
// Image-to-video payloads carry a base64 data URL, so allow a few MB.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function getNvidiaKey() {
  return process.env.NVIDIA_API_KEY || '';
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

// Extract the finished video URL defensively — the exact field name varies
// across NVIDIA's video models (video_url vs. video.url vs. url).
function extractVideoUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.video_url,
    data.videoUrl,
    data.url,
    data.video && data.video.url,
    data.video && data.video.content_url,
    data.video && data.video.download_url,
    data.video && data.video.video_url,
    data.assets && data.assets.video_url,
    data.assets && data.assets.video,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://glitchit.local');
  const apiKey = getNvidiaKey();

  if (!apiKey) {
    sendJson(res, 503, {
      ok: false,
      error: 'AI video generation is not configured yet — add the NVIDIA_API_KEY environment variable, then redeploy.',
    });
    return;
  }

  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // ---------- Poll an in-flight generation ----------
  if (req.method === 'GET') {
    const id = (url.searchParams.get('id') || '').trim();
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'An id query parameter is required.' });
      return;
    }
    let upstream;
    try {
      upstream = await fetch(`${NVIDIA_BASE_URL}/video/generations/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { Authorization: authHeaders.Authorization },
      });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: 'Could not reach the video generation service.' });
      return;
    }
    if (!upstream.ok) {
      let detail = '';
      try { detail = (await upstream.text()).slice(0, 300); } catch (err) { /* ignore */ }
      sendJson(res, upstream.status === 404 ? 404 : 502, {
        ok: false,
        status: 'failed',
        error: detail || `The video service returned an error (${upstream.status}).`,
      });
      return;
    }
    let data;
    try { data = await upstream.json(); } catch (err) { data = {}; }
    sendJson(res, 200, {
      ok: true,
      id: data.id || id,
      status: data.status || 'in_progress',
      videoUrl: extractVideoUrl(data),
    });
    return;
  }

  // ---------- Start a new generation ----------
  if (req.method === 'POST') {
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const prompt = body && typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      sendJson(res, 400, { ok: false, error: 'A prompt is required — describe the Glitch you want to create.' });
      return;
    }
    if (prompt.length > 4000) {
      sendJson(res, 400, { ok: false, error: 'Prompts are limited to 4,000 characters.' });
      return;
    }
    const payload = {
      model: body.model && typeof body.model === 'string' ? body.model.slice(0, 120) : DEFAULT_MODEL,
      prompt,
    };
    if (body.image && typeof body.image === 'string' && /^data:image\//.test(body.image)) {
      payload.image = body.image.slice(0, MAX_BODY_BYTES);
    }

    let upstream;
    try {
      upstream = await fetch(`${NVIDIA_BASE_URL}/video/generations`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: 'Could not reach the video generation service.' });
      return;
    }
    if (!upstream.ok) {
      let detail = '';
      try { detail = (await upstream.text()).slice(0, 400); } catch (err) { /* ignore */ }
      if (upstream.status === 401 || upstream.status === 403) {
        sendJson(res, 502, { ok: false, error: 'The NVIDIA API key is invalid — check the NVIDIA_API_KEY value.' });
      } else if (upstream.status === 429) {
        sendJson(res, 502, { ok: false, error: 'NVIDIA video credits are busy right now — try again in a minute.' });
      } else {
        // Pass the upstream message through (invalid model ids list valid ones).
        sendJson(res, 502, { ok: false, error: detail || `The video service returned an error (${upstream.status}).` });
      }
      return;
    }
    let data;
    try { data = await upstream.json(); } catch (err) { data = {}; }
    if (!data.id) {
      sendJson(res, 502, { ok: false, error: 'The video service did not return a generation id.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      id: data.id,
      status: data.status || 'in_progress',
    });
    return;
  }

  sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
};

// Video generations can take a minute or two; the client polls.
module.exports.config = { maxDuration: 60 };
