// GlitchIt AI assistant — Vercel serverless function for POST /api/chat.
// Vercel does not run server.js, so this mirrors its AI proxy: forward the
// conversation to NVIDIA's OpenAI-compatible endpoint and stream NDJSON lines
// back to the chat UI — the same {type,text} wire format server.js emits
// ({type:'reasoning'|'content'|'done'|'error', text}).
// Required env var (Vercel → Project Settings → Environment Variables):
//   NVIDIA_API_KEY
'use strict';

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

const SYSTEM_PROMPT = [
  'You are the GlitchIt AI assistant — a friendly, helpful support agent for GlitchIt,',
  'a social marketplace where creators share short glitch-style videos, photos, and',
  '"drops", and followers can shop creators\' storefronts.',
  'You help with: reporting bugs and complaints (and escalating to a real human',
  'support agent when needed), account and login issues, creating posts/videos with',
  'the in-app camera, saved videos, followers and drops, the marketplace/storefront',
  'and orders, and general product questions.',
  'Be warm and concise. Use plain language. When the user has a complaint or issue,',
  'acknowledge it, ask for the key details (what happened, what they expected), and',
  'tell them the fastest path to a fix — including that their complaint can be',
  'escalated to a human if you cannot resolve it. Never invent technical steps; if',
  'unsure, suggest contacting GlitchIt support.',
].join(' ');

// Parse NVIDIA's SSE stream and re-emit NDJSON {type,text} lines.
async function* parseSse(upstreamBody) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch (err) { continue; }
        const choice = chunk.choices && chunk.choices[0];
        if (!choice || !choice.delta) continue;
        const delta = choice.delta;
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          yield { type: 'reasoning', text: delta.reasoning_content };
        }
        if (typeof delta.reasoning === 'string' && delta.reasoning) {
          yield { type: 'reasoning', text: delta.reasoning };
        } else if (Array.isArray(delta.reasoning)) {
          // Structured reasoning: emit only the summary, not every internal step.
          const summary = delta.reasoning.find((r) => r && r.type === 'summary' && r.text);
          if (summary) yield { type: 'reasoning', text: summary.text };
        }
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'content', text: delta.content };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.NVIDIA_API_KEY || '';
  if (!apiKey) {
    res.status(503).json({ error: 'The AI assistant is not configured yet — add the NVIDIA_API_KEY environment variable in Vercel (Project → Settings → Environment Variables), then redeploy.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (err) { body = null; }
  }
  const messages = body && Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    res.status(400).json({ error: 'A messages[] array is required.' });
    return;
  }

  // Bound the conversation: last 24 messages, 6k chars each.
  const cleaned = messages
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  const handle = body && typeof body.user === 'string' ? body.user : '';
  cleaned.unshift({
    role: 'system',
    content: SYSTEM_PROMPT + (handle ? `\n\nThe person you are helping is @${handle}.` : ''),
  });

  let upstream;
  try {
    upstream = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: cleaned,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
        reasoning_budget: 16384,
      }),
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the AI service.' });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 300); } catch (err) { /* ignore */ }
    const status = upstream.status;
    if (status === 401 || status === 403) {
      res.status(502).json({ error: 'The AI assistant is not configured correctly (invalid API key).' });
    } else if (status === 429) {
      res.status(502).json({ error: 'The AI assistant is busy right now — please try again in a moment.' });
    } else {
      res.status(502).json({ error: detail || `The AI service returned an error (${status}).` });
    }
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  try {
    for await (const line of parseSse(upstream.body)) {
      if (res.writableEnded) break;
      try {
        res.write(JSON.stringify(line) + '\n');
      } catch (err) { break; }
      if (line.type === 'error') break;
    }
  } catch (err) { /* stream interrupted */ }
  try { res.end(); } catch (err) { /* client already gone */ }
};

// Streaming can take a while with thinking enabled (Hobby allows up to 60s).
module.exports.config = { maxDuration: 60 };
