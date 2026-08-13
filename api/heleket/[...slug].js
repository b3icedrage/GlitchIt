// GlitchIt — Vercel catch-all for /api/heleket/*.
// Vercel maps api/heleket.js only to the exact path /api/heleket; the app calls
// /api/heleket/create, /api/heleket/status and /api/heleket/webhook, so this
// catch-all routes every sub-path to the shared core handler in lib/.
'use strict';

module.exports = require('../../lib/heleket-core.js');
