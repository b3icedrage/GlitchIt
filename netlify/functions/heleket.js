// GlitchIt — Heleket crypto-payment proxy for Netlify.
// Netlify only auto-serves functions from netlify/functions/ (the repo's api/
// directory is the Vercel convention and 404s on Netlify). This is a thin
// adapter: it translates Netlify's (event, context) signature into the Node
// (req, res) handler used by api/heleket.js so there is exactly one source of
// truth for the signing logic and env vars:
//   HELEKET_API_KEY     - your Heleket payment API key
//   HELEKET_MERCHANT_ID - the merchant uuid from your Heleket account settings
'use strict';

const heleketHandler = require('../../api/heleket.js');

// Normalize whatever path Netlify hands us back to the /api/heleket/… form the
// core handler expects (it may arrive as /api/heleket/create or, after the
// netlify.toml rewrite, as /.netlify/functions/heleket/create).
function normalizePath(eventPath) {
  let path = String(eventPath || '/');
  path = path.replace(/^\/\.netlify\/functions\/heleket/, '');
  if (!path.startsWith('/api/heleket')) path = `/api/heleket${path}`;
  return path || '/api/heleket';
}

exports.handler = async (event) => {
  const req = {
    method: event.httpMethod || 'POST',
    url: normalizePath(event.path),
    headers: event.headers || {},
    body: event.body || '',
    [Symbol.asyncIterator]: function* () { yield event.body || ''; },
  };

  let statusCode = 200;
  const headers = {};
  let body = '';
  const res = {
    setHeader(k, v) { headers[k] = v; },
    end(d) { body = d; },
  };
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v) => { statusCode = v; },
  });

  await heleketHandler(req, res);
  return {
    statusCode,
    headers,
    body,
    isBase64Encoded: false,
  };
};
