// GlitchIt — Demo World.
// Deterministically generates 1,000 unique creators × 13 unique video posts
// (13,000 total) across 20 categories, and renders them into the existing
// feed surfaces (home feed, glitches feed, search accounts, right rail) ONLY
// when the real database has no content yet — real uploads always win.
//
// Every post is unique: creator (name, avatar, bio, stats), poster art
// (seeded SVG), title, caption, hashtags and like/comment/share counts.
// The video files themselves come from a small pool of public sample clips
// (all with sound) — synthesizing 13,000 distinct video files with unique
// audio isn't possible client-side, so the identity is unique while the clip
// pool is reused across posts.
//
// Nothing is written to Supabase; the whole layer is client-side, clearly
// badged "Demo world", and can be hidden with a persisted toggle.
(function () {
  'use strict';

  const USER_COUNT = 1000;
  const VIDS_PER_USER = 13;
  const DEMO_OFF_KEY = 'glitchit.demo.off';
  const DEMO_ROOT_CLASS = 'demo-world-root';

  // Public sample clips (all have audio). Stable Google-hosted test bucket.
  const SAMPLE_VIDEOS = [
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4',
  ];

  // 20 categories — matches the app's channel topics and beyond. Each has an
  // emoji, a gradient, handle words, title/caption templates and hashtags.
  const CATEGORIES = [
    { id: 'art', name: 'Art', emoji: '🎨', grad: ['#06b6d4', '#8b5cf6'], words: ['canvas', 'palette', 'brush', 'ink', 'sketch', 'pigment', 'gallery', 'mural'], nouns: ['mural', 'portrait', 'sketchbook', 'graffiti wall', 'watercolor', 'clay bust', 'street mural', 'ink study'], adj: ['neon', 'vintage', 'abstract', 'bold', 'quiet', 'electric', 'raw', 'soft'], tags: ['art', 'artist', 'painting', 'sketch', 'mural', 'studio'], titles: ['A {adj} study of {noun}', 'Painting {noun} tonight', 'Sketchbook: {noun}', 'Live mural — {noun}', '{adj} strokes on {noun}'] },
    { id: 'fashion', name: 'Fashion', emoji: '👗', grad: ['#ec4899', '#7c3aed'], words: ['runway', 'fits', 'vogue', 'style', 'hemline', 'thread', 'couture', 'wardrobe'], nouns: ['street fit', 'runway look', 'thrift haul', 'evening gown', 'oversized blazer', 'statement piece', 'sneaker rotation', 'silhouette'], adj: ['clean', 'bold', 'minimal', 'retro', 'editorial', 'daring', 'monochrome', 'textured'], tags: ['fashion', 'ootd', 'style', 'fits', 'runway', 'thrift'], titles: ['{adj} {noun} for the week', 'Try-on: {noun}', 'How I styled {noun}', '{adj} fits only', 'GRWM — {noun}'] },
    { id: 'music', name: 'Music', emoji: '🎵', grad: ['#22c55e', '#0ea5e9'], words: ['beat', 'melody', 'rhythm', 'chorus', 'vinyl', 'tempo', 'harmony', 'groove'], nouns: ['afrobeats loop', 'night set', 'studio session', 'vinyl flip', 'bass line', 'choir take', 'live jam', 'soul sample'], adj: ['smooth', 'heavy', 'dreamy', 'groovy', 'raw', 'hypnotic', 'warm', 'electric'], tags: ['music', 'afrobeats', 'studio', 'live', 'producer', 'vinyl'], titles: ['Making a {adj} beat from {noun}', 'Studio session: {noun}', 'Flip this {noun}', 'Live: {noun}', '{adj} {noun} you need to hear'] },
    { id: 'sports', name: 'Sports', emoji: '⚽', grad: ['#22c55e', '#15803d'], words: ['goals', 'game', 'pitch', 'ace', 'trophy', 'sprint', 'dribble', 'finals'], nouns: ['matchday', 'training drill', 'overtime', 'penalty shootout', 'lap record', 'comeback', 'team huddle', 'finals run'], adj: ['clutch', 'relentless', 'quick', 'tough', 'electric', 'sharp', 'unstoppable', 'classic'], tags: ['sports', 'football', 'matchday', 'training', 'goals', 'fitness'], titles: ['{adj} {noun} highlights', 'Behind the scenes: {noun}', 'Training for {noun}', 'The {adj} comeback', 'Matchday {noun} vlog'] },
    { id: 'comedy', name: 'Comedy', emoji: '😹', grad: ['#f97316', '#e11d48'], words: ['lol', 'skits', 'funny', 'jokes', 'comedy', 'pranks', 'memes', 'gags'], nouns: ['family skit', 'office prank', 'reaction bit', 'parody clip', 'awkward moment', 'roast session', 'storytime', 'duet bit'], adj: ['wild', 'unhinged', 'relatable', 'absurd', 'chaotic', 'cringe', 'iconic', 'peak'], tags: ['comedy', 'skits', 'funny', 'memes', 'pranks', 'relatable'], titles: ['POV: {noun}', 'Trying {noun} for the first time', 'The {adj} {noun} saga', 'My family reacts to {noun}', '{adj} {noun} energy'] },
    { id: 'gaming', name: 'Gaming', emoji: '🎮', grad: ['#8b5cf6', '#312e81'], words: ['gamer', 'gg', 'pixel', 'clutch', 'ranked', 'frags', 'loot', 'ggs'], nouns: ['ranked lobby', 'boss fight', 'speedrun', 'clutch play', 'final circle', 'raid night', 'couch co-op', 'patch notes'], adj: ['insane', 'clean', 'tilted', 'grindy', 'epic', 'sweaty', 'casual', 'toxic'], tags: ['gaming', 'fyp', 'clutch', 'ranked', 'gamer', 'highlights'], titles: ['{adj} {noun} highlights', 'Ranked grind: {noun}', 'Beating {noun} no damage', 'The {adj} final circle', 'Reacting to {noun} patch'] },
    { id: 'movies', name: 'Movies', emoji: '🎬', grad: ['#3b82f6', '#1e3a8a'], words: ['cinema', 'film', 'scene', 'reel', 'director', 'script', 'theater', 'cuts'], nouns: ['movie night', 'behind the scenes', 'director cut', 'plot twist', 'marathon', 'audition tape', 'film score', 'final act'], adj: ['cinematic', 'gripping', 'nostalgic', 'dark', 'feel-good', 'epic', 'subtle', 'iconic'], tags: ['movies', 'cinema', 'film', 'movieclips', 'review', 'theater'], titles: ['{adj} {noun} review', 'Ranking {noun}', 'The plot twist in {noun}', 'BTS: {noun}', '10/10 {noun} energy'] },
    { id: 'people', name: 'People', emoji: '🧑🏾‍🤝‍🧑🏽', grad: ['#f59e0b', '#ef4444'], words: ['fam', 'crew', 'people', 'tribe', 'circle', 'vibes', 'squad', 'hive'], nouns: ['community day', 'family reunion', 'street interview', 'first date', 'friendsgiving', 'neighborhood walk', 'meet the crew', 'day in the life'], adj: ['warm', 'real', 'vibrant', 'honest', 'funny', 'heartfelt', 'busy', 'chill'], tags: ['people', 'vlog', 'family', 'friends', 'community', 'dayinthelife'], titles: ['{adj} {noun} vlog', 'A {noun} to remember', 'We asked strangers: {noun}', '{noun} with the fam', 'My {adj} {noun}'] },
    { id: 'food', name: 'Food', emoji: '🍲', grad: ['#f472b6', '#be185d'], words: ['taste', 'bites', 'chef', 'grub', 'recipe', 'flavor', 'kitchen', 'munch'], nouns: ['street food run', 'family recipe', 'spicy challenge', 'midnight snack', 'brunch spread', 'chef table', 'pantry raid', 'taste test'], adj: ['spicy', 'savory', 'sweet', 'smoky', 'creamy', 'crispy', 'bold', 'comfort'], tags: ['food', 'recipe', 'cooking', 'streetfood', 'tasty', 'foodie'], titles: ['Cooking {noun} from scratch', 'Trying the {adj} {noun} challenge', 'My {noun} recipe', 'Street food: {noun}', '{adj} {noun} at 2am'] },
    { id: 'travel', name: 'Travel', emoji: '✈️', grad: ['#0ea5e9', '#06b6d4'], words: ['wander', 'trips', 'nomad', 'routes', 'passport', 'safari', 'globe', 'journey'], nouns: ['road trip', 'hidden beach', 'city tour', 'safari morning', 'mountain hike', 'airport run', 'island hop', 'night market'], adj: ['scenic', 'remote', 'breezy', 'sunset', 'wild', 'coastal', 'serene', 'bustling'], tags: ['travel', 'wanderlust', 'safari', 'adventure', 'roadtrip', 'travelgram'], titles: ['{adj} {noun} vlog', '24 hours in {noun}', 'Finding {noun} off the map', 'My {noun} essentials', 'The {adj} {noun}'] },
    { id: 'tech', name: 'Tech', emoji: '💻', grad: ['#6366f1', '#0f172a'], words: ['code', 'bytes', 'dev', 'stack', 'pixel', 'chip', 'kernel', 'logic'], nouns: ['build log', 'desk setup', 'code review', 'AI demo', 'hackathon', 'app launch', 'keyboard build', 'debug session'], adj: ['clean', 'janky', 'fast', 'retro', 'minimal', 'over-engineered', 'silky', 'brutalist'], tags: ['tech', 'coding', 'developer', 'ai', 'build', 'setup'], titles: ['Building {noun} in a weekend', 'My {noun} setup tour', 'Debugging {noun} live', 'I made {noun} with AI', 'The {adj} {noun}'] },
    { id: 'nature', name: 'Nature', emoji: '🌿', grad: ['#16a34a', '#065f46'], words: ['green', 'wild', 'flora', 'earth', 'canopy', 'trails', 'roots', 'bloom'], nouns: ['sunrise hike', 'rainforest walk', 'garden bloom', 'river swim', 'bird watch', 'mountain mist', 'wildflower field', 'night sky'], adj: ['lush', 'misty', 'golden', 'quiet', 'breezy', 'wild', 'calm', 'vivid'], tags: ['nature', 'outdoors', 'hiking', 'wildlife', 'earth', 'serene'], titles: ['{adj} {noun} escape', 'Chasing {noun} at dawn', 'A walk through {noun}', '{noun} in 4k', 'The {adj} {noun}'] },
    { id: 'dance', name: 'Dance', emoji: '🕺🏾', grad: ['#d62976', '#4f5bd5'], words: ['moves', 'groove', 'bop', 'shuffle', 'twist', 'stepz', 'flow', 'swag'], nouns: ['challenge', 'freestyle', 'street battle', 'rehearsal', 'duet', 'afro routine', 'transition', 'solo set'], adj: ['clean', 'smooth', 'energetic', 'sharp', 'fluid', 'wild', 'iconic', 'tight'], tags: ['dance', 'reels', 'challenge', 'freestyle', 'afrobeats', 'moves'], titles: ['New {noun} with the crew', 'Teaching the {noun} step', 'My {adj} {noun}', 'Battle: {noun}', 'The {noun} challenge'] },
    { id: 'cars', name: 'Cars', emoji: '🚗', grad: ['#f43f5e', '#111827'], words: ['drive', 'garage', 'revs', 'torque', 'motor', 'piston', 'cruise', 'wheels'], nouns: ['garage tour', 'detail day', 'night drive', 'track day', 'engine swap', 'car meet', 'detailing', 'first start'], adj: ['sleek', 'loud', 'classic', 'beefy', 'clean', 'nostalgic', 'aggressive', 'showroom'], tags: ['cars', 'carspotting', 'garage', 'drift', 'details', 'rides'], titles: ['{adj} {noun} vlog', 'Full {noun} tour', 'The {noun} nobody expects', 'Building {noun}', 'First start of {noun}'] },
    { id: 'beauty', name: 'Beauty', emoji: '💄', grad: ['#fda4af', '#9d174d'], words: ['glow', 'beauty', 'shade', 'lipstick', 'serum', 'mascara', 'blush', 'glam'], nouns: ['GRWM', 'makeup haul', 'skincare routine', 'bold lip look', 'foundation test', 'hair flip', 'spa night', 'product test'], adj: ['dewy', 'bold', 'soft', 'glossy', 'natural', 'glam', 'fresh', 'editorial'], tags: ['beauty', 'makeup', 'skincare', 'grwm', 'glam', 'hair'], titles: ['{adj} {noun} tutorial', 'Testing {noun} for a week', 'My {noun} secrets', 'GRWM: {noun}', 'The {adj} {noun}'] },
    { id: 'fitness', name: 'Fitness', emoji: '🏋🏾', grad: ['#84cc16', '#166534'], words: ['gains', 'lift', 'sweat', 'reps', 'core', 'runner', 'flex', 'endure'], nouns: ['leg day', 'morning run', 'home workout', 'gym session', 'stretch routine', 'sprint set', 'pull day', 'recovery'], adj: ['brutal', 'quick', 'steady', 'intense', 'smooth', 'heavy', 'consistent', 'powerful'], tags: ['fitness', 'gym', 'workout', 'gains', 'run', 'health'], titles: ['{adj} {noun} — no excuses', 'My {noun} circuit', 'Day one of {noun}', 'Full {noun} at home', 'The {adj} {noun}'] },
    { id: 'news', name: 'News', emoji: '📰', grad: ['#64748b', '#1e293b'], words: ['brief', 'press', 'daily', 'update', 'report', 'feed', 'alert', 'bulletin'], nouns: ['morning brief', 'market update', 'tech headline', 'city report', 'breaking news', 'climate digest', 'sports desk', 'election watch'], adj: ['breaking', 'daily', 'quick', 'sharp', 'reliable', 'fresh', 'live', 'clear'], tags: ['news', 'update', 'dailybrief', 'trending', 'headlines', 'live'], titles: ['{adj} {noun}', '5 things: {noun}', 'The {noun} explained', 'Live {noun}', '{noun} in 60 seconds'] },
    { id: 'anime', name: 'Anime', emoji: '🎌', grad: ['#fb7185', '#7c3aed'], words: ['otaku', 'manga', 'shonen', 'cosplay', 'waifu', 'kawaii', 'sensei', 'akira'], nouns: ['cosplay reveal', 'manga haul', 'episode reaction', 'character tierlist', 'studio Ghibli night', 'power ranking', 'fan art', 'opening marathon'], adj: ['epic', 'wholesome', 'chaotic', 'peak', 'nostalgic', 'overpowered', 'cute', 'emotional'], tags: ['anime', 'manga', 'cosplay', 'otaku', 'reaction', 'edit'], titles: ['{adj} {noun} reaction', 'Ranking {noun}', 'My {noun} cosplay', 'The {noun} breakdown', '{noun} but every frame'] },
    { id: 'pets', name: 'Pets', emoji: '🐾', grad: ['#fbbf24', '#b45309'], words: ['paws', 'fur', 'tails', 'pets', 'whiskers', 'howl', 'naps', 'zoomies'], nouns: ['zoomies', 'bath time', 'first walk', 'treat taste test', 'nap compilation', 'trick training', 'vet visit', 'playdate'], adj: ['chaotic', 'fluffy', 'sleepy', 'hyper', 'dramatic', 'gentle', 'silly', 'majestic'], tags: ['pets', 'dogs', 'cats', 'animals', 'cute', 'petsOfGlitchIt'], titles: ['{noun} but make it dramatic', 'My pet tries {noun}', '{adj} {noun} compilation', 'Teaching {noun} a trick', 'The {noun} nobody asked for'] },
    { id: 'science', name: 'Science', emoji: '🔬', grad: ['#38bdf8', '#155e75'], words: ['lab', 'quanta', 'cosmos', 'reactor', 'specimen', 'theory', 'orbit', 'fusion'], nouns: ['lab experiment', 'night sky', 'rocket test', 'microscope session', 'physics demo', 'volcano kit', 'battery build', 'weather watch'], adj: ['explosive', 'tiny', 'glowing', 'precise', 'spacey', 'fizzy', 'cold', 'mind-bending'], tags: ['science', 'space', 'experiment', 'lab', 'physics', 'stem'], titles: ['{adj} {noun} at home', 'The {noun} explained', 'Building {noun}', '{noun} in slow motion', 'Why {noun} happens'] },
  ];

  // ---------- GlitchIt — the AI creator ----------
  // A pinned creator whose handle is "glitchit" and who posts a fresh
  // AI-themed video every minute while a feed is open. Every post is
  // deterministic (title, caption, neural poster art, trending stats) and
  // uses the same sample clips with sound as the rest of the demo world.
  const GLITCHIT_ID = 'demo-glitchit';
  const GLITCHIT_HANDLE = 'glitchit';
  const GLITCHIT_AVATAR = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${gradient('giglitchit', '#6366f1', '#06b6d4')}<circle cx="48" cy="48" r="48" fill="url(#giglitchit)"/><text x="48" y="60" font-size="42" text-anchor="middle">⚡</text></svg>`
  );

  const AI_VERBS = ['rendered', 'imagined', 'dreamed', 'generated', 'animated', 'painted', 'hallucinated', 'simulated'];
  const AI_ADJ = ['neon', 'surreal', 'holographic', 'infinite', 'cyberpunk', 'glowing', 'liquid', 'impossible', 'vibrant', 'soft'];
  const AI_NOUNS = ['cityscape', 'dreamscape', 'dance loop', 'skyline', 'ocean dream', 'neon forest', 'fashion show', 'robot ballet', 'galaxy road', 'concert hall', 'night street', 'sports arena', 'secret garden', 'desert highway'];
  const AI_TITLE_TPL = [
    'AI {verb} a {adj} {noun}',
    'The {adj} {noun} — AI made this',
    '{noun} but it\'s AI',
    'Neural {noun} loop',
    'What AI sees: {adj} {noun}',
    'Watch AI {verb} a {noun}',
    '{adj} {noun} — trending now',
    'AI {noun} in motion',
  ];
  const AI_TAGS = ['ai', 'aivideo', 'aiart', 'neural', 'future', 'trending', 'glitchit'];

  function glitchItUser() {
    return {
      id: GLITCHIT_ID,
      handle: GLITCHIT_HANDLE,
      display: 'GlitchIt',
      avatar: GLITCHIT_AVATAR,
      bio: 'AI videos, new every minute ⚡',
      verified: true,
      followers: 482000,
      category: null,
    };
  }

  // Neural-style poster art: dark canvas, glowing gradient orb, circuit lines.
  function glitchItPoster(seed, title) {
    const rng = mulberry32(seed);
    const hue = Math.floor(rng() * 360);
    const gid = 'gi' + seed;
    const c1 = `hsl(${hue} 95% 62%)`;
    const c2 = `hsl(${(hue + 120) % 360} 95% 45%)`;
    const lines = Array.from({ length: 6 }, () => {
      const x = Math.floor(rng() * 370);
      const y = Math.floor(rng() * 470);
      return `<path d="M ${x} ${y} l ${20 + rng() * 50} ${10 + rng() * 70}" stroke="rgba(255,255,255,.35)" stroke-width="1.5" fill="none"/>`;
    }).join('');
    const nodes = Array.from({ length: 5 }, () => {
      const cx = Math.floor(rng() * 380);
      const cy = Math.floor(rng() * 480);
      return `<circle cx="${cx}" cy="${cy}" r="${(1.5 + rng() * 2).toFixed(1)}" fill="#fff" opacity=".8"/>`;
    }).join('');
    const bars = Array.from({ length: 3 }, () => {
      const y = Math.floor(rng() * 300);
      const h = 1 + Math.floor(rng() * 6);
      const x = Math.floor(rng() * 40);
      return `<rect x="${x}" y="${y}" width="${80 - x}" height="${h}" fill="rgba(255,255,255,.14)"/>`;
    }).join('');
    return svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">${gradient(gid, c1, c2)}<rect width="400" height="500" fill="#05060f"/><circle cx="200" cy="230" r="118" fill="url(#${gid})" opacity=".9"/><circle cx="200" cy="230" r="118" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>${lines}${nodes}${bars}<text x="200" y="112" font-size="16" text-anchor="middle" fill="rgba(255,255,255,.65)" font-family="sans-serif" letter-spacing="7">AI VIDEO</text><text x="200" y="408" font-size="22" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">${esc(title.slice(0, 30))}</text><text x="200" y="434" font-size="13" text-anchor="middle" fill="rgba(255,255,255,.6)" font-family="sans-serif">@glitchit · neural render</text></svg>`
    );
  }

  // The n-th AI post (n = minutes ago it was "published"). Trending stats and
  // a rotating caption make every post feel fresh.
  function glitchItVideoAt(n) {
    const seed = hashStr('glitchit-ai:' + n);
    const rng = mulberry32(seed);
    const title = pick(rng, AI_TITLE_TPL)
      .replace('{verb}', pick(rng, AI_VERBS))
      .replace('{adj}', pick(rng, AI_ADJ))
      .replace('{noun}', pick(rng, AI_NOUNS));
    const tags = [...AI_TAGS].sort(() => rng() - 0.5).slice(0, 3);
    const caption = `${title}${tags.map((t) => ' #' + t).join('')}`;
    return {
      id: GLITCHIT_ID + '-ai-' + n,
      title,
      caption,
      src: SAMPLE_VIDEOS[(n + 7) % SAMPLE_VIDEOS.length],
      poster: glitchItPoster(seed, title),
      user: GLITCHIT_HANDLE,
      display: 'GlitchIt',
      avatar: GLITCHIT_AVATAR,
      verified: true,
      owner: GLITCHIT_ID,
      likes: String(1400 + Math.floor(rng() * 9600)),
      comments: String(120 + Math.floor(rng() * 900)),
      shares: String(60 + Math.floor(rng() * 700)),
      created_at: Date.now() - n * 60000,
    };
  }

  // ---------- deterministic PRNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---------- helpers ----------
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }
  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }
  function svgUri(svg) {
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function gradient(id, c1, c2) {
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>`;
  }

  function demoEnabled() {
    try { return localStorage.getItem(DEMO_OFF_KEY) !== '1'; } catch (e) { return true; }
  }

  // ---------- user + video generation (deterministic per index) ----------
  function userAt(userIdx) {
    const cat = CATEGORIES[userIdx % CATEGORIES.length];
    const rng = mulberry32(hashStr('user:' + userIdx));
    const a = pick(rng, cat.words);
    const b = pick(rng, cat.words);
    const num = String(10 + Math.floor(rng() * 90));
    const handle = `${a}.${b}${num}`;
    const display = (a[0].toUpperCase() + a.slice(1)) + ' ' + (b[0].toUpperCase() + b.slice(1));
    const bio = pick(rng, [
      `${cat.emoji} ${cat.name} on GlitchIt. ${a} first, ${b} always.`,
      `Posting ${cat.name} drops — ${a} × ${b}.`,
      `${cat.name} creator ✦ ${a}/${b} ✦ new reel every day.`,
      `All things ${cat.name}. Tap follow for the ${a} side of me.`,
    ]);
    const verified = rng() < 0.12;
    const followers = Math.floor(rng() * 15000);
    // Avatar: gradient disc + category emoji + initials. The gradient id is
    // unique per user — ids are document-global, so shared ids would make
    // every avatar/poster resolve to the first one's gradient.
    const avId = 'ga' + userIdx;
    const initials = (a[0] + b[0]).toUpperCase();
    const avatar = svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${gradient(avId, cat.grad[0], cat.grad[1])}<circle cx="48" cy="48" r="48" fill="url(#${avId})"/><text x="48" y="46" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="800">${esc(initials)}</text><text x="48" y="70" font-size="22" text-anchor="middle">${cat.emoji}</text></svg>`
    );
    return {
      id: 'demo-' + String(userIdx).padStart(4, '0'),
      handle,
      display,
      avatar,
      bio,
      verified,
      followers,
      category: cat,
    };
  }

  function videoAt(userIdx, vIdx) {
    const user = userAt(userIdx);
    const cat = user.category;
    const seed = hashStr('video:' + userIdx + ':' + vIdx);
    const rng = mulberry32(seed);
    const title = pick(rng, cat.titles).replace('{noun}', pick(rng, cat.nouns)).replace('{adj}', pick(rng, cat.adj));
    const tags = [...cat.tags].sort(() => rng() - 0.5).slice(0, 2 + Math.floor(rng() * 2));
    const caption = `${title}${tags.map((t) => ' #' + t).join('')}`;
    const src = SAMPLE_VIDEOS[(userIdx + vIdx) % SAMPLE_VIDEOS.length];
    // Poster: unique seeded gradient + glitch bars + category emoji + title.
    const hue = Math.floor(rng() * 360);
    const c1 = `hsl(${hue} 70% 28%)`, c2 = `hsl(${(hue + 60) % 360} 80% 12%)`;
    const bars = Array.from({ length: 4 }, () => {
      const y = Math.floor(rng() * 300);
      const h = 2 + Math.floor(rng() * 10);
      const x = Math.floor(rng() * 60);
      return `<rect x="${x}" y="${y}" width="${80 - x}" height="${h}" fill="rgba(255,255,255,${(0.08 + rng() * 0.2).toFixed(2)})"/>`;
    }).join('');
    const pid = 'gp' + seed;
    const poster = svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">${gradient(pid, c1, c2)}<rect width="400" height="500" fill="url(#${pid})"/>${bars}<text x="200" y="210" font-size="90" text-anchor="middle">${cat.emoji}</text><text x="200" y="330" font-size="24" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">${esc(title.slice(0, 32))}</text><text x="200" y="360" font-size="14" text-anchor="middle" fill="rgba(255,255,255,.7)" font-family="sans-serif">@${esc(user.handle)} · ${cat.emoji} ${cat.name}</text></svg>`
    );
    const likes = 12 + Math.floor(rng() * 4800);
    const comments = Math.floor(rng() * 640);
    const shares = Math.floor(rng() * 320);
    const created_at = Date.now() - Math.floor(rng() * 180 * 86400000);
    return {
      id: `demo-${String(userIdx).padStart(4, '0')}-${String(vIdx).padStart(2, '0')}`,
      title,
      caption,
      src,
      poster,
      user: user.handle,
      display: user.display,
      avatar: user.avatar,
      verified: user.verified,
      owner: user.id,
      likes: String(likes),
      comments: String(comments),
      shares: String(shares),
      category: cat,
      created_at,
    };
  }

  // Flat list index -> video. Deterministic, O(1) per item.
  function videoByIndex(idx) {
    const userIdx = Math.floor(idx / VIDS_PER_USER) % USER_COUNT;
    const vIdx = idx % VIDS_PER_USER;
    return videoAt(userIdx, vIdx);
  }

  // ---------- rendering ----------
  function chipHtml(count) {
    return `<div class="demo-chip"><span class="demo-chip-dot">✦</span><b>Demo world</b><span>${count.toLocaleString()} unique posts from ${USER_COUNT.toLocaleString()} creators across ${CATEGORIES.length} categories</span><button type="button" class="demo-hide" aria-label="Hide demo world">Hide</button></div>`;
  }

  function renderReels(container, root, start, count) {
    const frag = document.createDocumentFragment();
    for (let i = start; i < start + count; i++) {
      const v = videoByIndex(i);
      if (typeof window.glitchVideoCard === 'function') {
        frag.appendChild(htmlToNode(window.glitchVideoCard({
          id: v.id, title: v.title, caption: v.caption, src: v.src, poster: v.poster,
          user: v.user, avatar: v.avatar, verified: v.verified, owner: v.owner,
          likes: v.likes, comments: v.comments, shares: v.shares,
        })));
      }
    }
    root.appendChild(frag);
    // Wire the interactions exactly like main.js does for real cards.
    if (typeof window.attachGlitchAutoplay === 'function') window.attachGlitchAutoplay();
    if (typeof window.attachReelsActions === 'function') window.attachReelsActions();
    if (typeof window.markSavedReels === 'function') window.markSavedReels();
  }

  function htmlToNode(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function loadMoreButton(total, perChunk) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-more';
    btn.textContent = `Load more demo reels (${Math.min(perChunk, total).toLocaleString()} more)`;
    return btn;
  }

  function buildDemoRoot(container, total) {
    const root = document.createElement('div');
    root.className = DEMO_ROOT_CLASS;
    root.innerHTML = chipHtml(total);

    // GlitchIt — pinned AI creator that posts a new video every minute.
    const live = document.createElement('div');
    live.className = 'glitchit-live';
    const glitchRow = document.createElement('div');
    glitchRow.className = 'glitchit-row';
    glitchRow.innerHTML = `<span class="glitchit-avatar"><img src="${GLITCHIT_AVATAR}" alt="GlitchIt avatar"></span><div class="glitchit-meta"><strong>GlitchIt${typeof window.verifiedBolt === 'function' ? window.verifiedBolt('verified-bolt-inline') : ''}</strong><span><i class="glitchit-dot" aria-hidden="true"></i>AI creator · posting a new video every minute</span></div><b class="glitchit-count">…</b>`;
    const countEl = glitchRow.querySelector('.glitchit-count');
    root.appendChild(glitchRow);
    root.appendChild(live);

    const cards = document.createElement('div');
    cards.className = 'demo-cards';
    root.appendChild(cards);
    const perChunk = 12;
    let offset = 0;
    let liveTimer = null;
    let postIndex = 6;

    const glitchItCard = (v, newest) => {
      if (typeof window.glitchVideoCard !== 'function') return null;
      const node = htmlToNode(window.glitchVideoCard({
        id: v.id, title: v.title, caption: v.caption, src: v.src, poster: v.poster,
        user: v.user, avatar: v.avatar, verified: v.verified, owner: v.owner,
        likes: v.likes, comments: v.comments, shares: v.shares,
      }));
      if (newest) node.classList.add('glitchit-new');
      return node;
    };
    const refreshLive = () => {
      const node = glitchItCard(glitchItVideoAt(postIndex), true);
      if (!node) return;
      live.prepend(node);
      while (live.children.length > 12) live.lastChild.remove();
      if (countEl) countEl.textContent = `${live.children.length} fresh`;
      if (typeof window.attachGlitchAutoplay === 'function') window.attachGlitchAutoplay();
      if (typeof window.attachReelsActions === 'function') window.attachReelsActions();
      if (typeof window.markSavedReels === 'function') window.markSavedReels();
    };
    // Backfill the last six minutes so the creator isn't silent on load
    // (newest first, matching the live order).
    for (let i = 5; i >= 0; i--) {
      const node = glitchItCard(glitchItVideoAt(i), false);
      if (node) live.prepend(node);
    }
    if (countEl) countEl.textContent = `${live.children.length} fresh`;
    liveTimer = setInterval(() => { if (root.isConnected) refreshLive(); }, 60000);

    const renderNext = () => {
      const remaining = total - offset;
      if (remaining <= 0) return;
      const n = Math.min(perChunk, remaining);
      renderReels(container, cards, offset, n);
      offset += n;
      if (offset < total) {
        const more = loadMoreButton(total - offset, perChunk);
        more.addEventListener('click', () => {
          more.remove();
          renderNext();
        });
        cards.appendChild(more);
      }
    };
    renderNext();
    root.querySelector('.demo-hide')?.addEventListener('click', () => {
      if (liveTimer) clearInterval(liveTimer);
      try { localStorage.setItem(DEMO_OFF_KEY, '1'); } catch (e) { /* ignore */ }
      root.remove();
      restoreEmpty(container);
    });
    return root;
  }

  function restoreEmpty(container) {
    const empty = container.querySelector('.feed-empty, .rail-empty, .sr-empty');
    if (empty) return; // still there
    const page = document.body.dataset.page;
    const target = container.id === 'video-feed'
      ? '<div class="feed-empty"><span class="feed-empty-mark">▣</span><h3>No glitches yet</h3><p>Share a reel and it will appear here for everyone.</p></div>'
      : container.id === 'upload-feed'
        ? '<div class="feed-empty"><span class="feed-empty-mark">ϟ</span><h3>No posts yet</h3><p>Be the first to share a moment.</p></div>'
        : page === 'search'
          ? '<div class="sr-empty"><span class="sr-empty-mark">⌕</span><h3>No accounts yet</h3><p>Accounts that post on GlitchIt will show up here.</p></div>'
          : '<div class="rail-empty"><span class="rail-empty-mark">ϟ</span><p>No creators yet</p><small>Creators who post will show up here.</small></div>';
    container.innerHTML = empty;
  }

  // Search accounts row (same markup as main.js srAccountRow).
  function accountRow(c) {
    const handle = esc(c.handle);
    const avatar = c.avatar
      ? `<img src="${esc(c.avatar)}" alt="${handle} avatar" loading="lazy">`
      : `<span class="badge" aria-hidden="true"><i>${esc(handle[0]?.toUpperCase() || 'G')}</i></span>`;
    const bolt = c.verified && typeof window.verifiedBolt === 'function' ? window.verifiedBolt('verified-bolt-inline') : '';
    const followers = Number(c.followers) || 0;
    const meta = followers > 0 ? `${typeof fmtCount === 'function' ? fmtCount(followers) : followers} followers` : 'No followers yet';
    return `<a class="sr-acct" href="user.html?id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.handle)}"><span class="sr-avatar">${avatar}</span><span class="sr-info"><span class="sr-name">${handle}${bolt}</span><span class="sr-meta">${meta}</span></span></a>`;
  }

  function renderDemoAccounts(list, total, query) {
    const frag = document.createDocumentFragment();
    const q = String(query || '').trim().toLowerCase();
    // GlitchIt (the AI creator) is pinned to the top of the account list
    // whenever the query is empty or mentions GlitchIt / AI.
    if (!q || q === 'glitchit' || 'glitchit'.includes(q) || 'ai'.includes(q)) {
      frag.appendChild(htmlToNode(accountRow(glitchItUser())));
    }
    const rows = [];
    for (let i = 0; i < Math.min(total, USER_COUNT); i++) {
      const u = userAt(i);
      if (q && !u.handle.toLowerCase().includes(q)) continue;
      rows.push(u);
    }
    if (q && !rows.length && !frag.childNodes.length) {
      // Keep the demo chip visible and show the no-match message under it,
      // so the observer never churns (re-injecting the chip repeatedly).
      list.appendChild(htmlToNode(`<div class="sr-empty"><span class="sr-empty-mark">⌕</span><h3>No accounts found</h3><p>No demo creator matches “${esc(q)}”.</p></div>`));
      return;
    }
    rows.forEach((u) => frag.appendChild(htmlToNode(accountRow(u))));
    list.appendChild(frag);
  }

  // Right-rail suggestions (same markup as main.js hydrateRail).
  function renderDemoRail(list) {
    list.innerHTML = '';
    // GlitchIt is pinned first; then the usual demo creators.
    const rows = [glitchItUser()];
    for (let i = 0; i < Math.min(4, USER_COUNT); i++) rows.push(userAt(i));
    rows.forEach((u) => {
      const handle = esc(u.handle);
      const bolt = u.verified && typeof window.verifiedBolt === 'function' ? window.verifiedBolt('verified-bolt-inline') : '';
      const seller = document.createElement('div');
      seller.className = 'seller';
      seller.dataset.owner = u.id;
      seller.innerHTML = `<div><strong>${handle}${bolt}</strong><span>${u.display && u.display !== u.handle ? 'AI creator' : 'Creator'}</span></div><button type="button">Follow</button>`;
      const btn = seller.querySelector('button');
      const syncBtn = () => {
        const on = typeof window.isFollowing === 'function' && window.isFollowing(u.id);
        btn.classList.toggle('following', on);
        btn.textContent = on ? 'Following' : 'Follow';
      };
      syncBtn();
      btn.addEventListener('click', () => {
        if (typeof window.setFollowing === 'function') {
          const next = !(typeof window.isFollowing === 'function' && window.isFollowing(u.id));
          window.setFollowing(u.id, next);
        }
        syncBtn();
      });
      list.appendChild(seller);
    });
  }

  // ---------- wiring ----------
  function observeContainer(container, kind) {
    if (!container) return;
    let injected = false;

    // Demo cards reuse the real card markup (main.js glitchVideoCard /
    // uploadCard / srAccountRow / seller). For accounts & rail we only fill
    // when there is no real content at all. For feeds the demo world always
    // shows — cloud posts that load later appear ABOVE it instead of
    // removing it (the user asked for it to stay even when not empty).
    const REAL_SELECTOR = '.video-card:not(.upload-card), .post:not(.upload-card), .seller, .sr-acct';
    const tryInject = () => {
      if (!demoEnabled()) return;
      if (container.querySelector('.' + DEMO_ROOT_CLASS)) return; // already up — never removed
      if ((kind === 'accounts' || kind === 'rail') && container.querySelector(REAL_SELECTOR)) return;
      // main.js re-renders the search accounts list on every keystroke and
      // wipes the demo chip when it does; allow re-injection only while the
      // chip is gone, so observer churn never duplicates the demo rows.
      if (kind === 'accounts' && !container.querySelector('.demo-chip')) injected = false;
      // Feeds re-inject whenever the root is missing (e.g. main.js replaced
      // the container with local uploads); the root presence check above
      // keeps that from ever duplicating.
      if (injected && kind !== 'reels' && kind !== 'posts') return;
      injected = true;

      if (kind === 'reels' || kind === 'posts') {
        // Drop any "no posts yet" card so the demo chip sits on top.
        container.querySelector('.feed-empty, .rail-empty, .sr-empty')?.remove();
        container.appendChild(buildDemoRoot(container, USER_COUNT * VIDS_PER_USER));
      } else if (kind === 'accounts') {
        container.innerHTML = '';
        container.appendChild(htmlToNode(chipHtml(USER_COUNT)));
        const qBox = document.getElementById('sr-query');
        renderDemoAccounts(container, USER_COUNT, qBox ? qBox.value : '');
        container.querySelector('.demo-hide')?.addEventListener('click', () => {
          try { localStorage.setItem(DEMO_OFF_KEY, '1'); } catch (e) { /* ignore */ }
          container.innerHTML = '<div class="sr-empty"><span class="sr-empty-mark">⌕</span><h3>No accounts yet</h3><p>Accounts that post on GlitchIt will show up here.</p></div>';
        });
      } else if (kind === 'rail') {
        container.innerHTML = '';
        renderDemoRail(container);
      }
    };

    // Retry a few times: main.js hydrates these asynchronously.
    const observer = new MutationObserver(tryInject);
    observer.observe(container, { childList: true, subtree: true });
    [0, 300, 900, 1800, 3200].forEach((delay) => setTimeout(tryInject, delay));
  }

  function init() {
    const page = document.body.dataset.page || 'home';
    if (page === 'glitches') observeContainer(document.getElementById('video-feed'), 'reels');
    if (page === 'home') observeContainer(document.getElementById('upload-feed'), 'posts');
    if (page === 'search') observeContainer(document.getElementById('sr-accounts'), 'accounts');
    observeContainer(document.querySelector('.rail-suggestions'), 'rail');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
