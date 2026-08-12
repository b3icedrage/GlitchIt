# GlitchIt — Infrastructure Catalog Mapping

Category-by-category map of the infrastructure catalog to what GlitchIt actually
runs today, with notes on what is intentionally deferred. GlitchIt is a static
vanilla-JS multi-page app (11 screens, no framework, no build step) backed by
Supabase for auth and database plus Cloudinary for media storage — so a lot of
the catalog is "handled for us" rather than self-managed.

---

## Infrastructure & Compute

| Catalog item | GlitchIt today |
| --- | --- |
| Cloud & Hardware (VMs, VPCs, GPU) | **None self-managed.** The app is a static frontend; compute is the managed preview VM (dev) and the managed static hosting (prod). No VMs, VPCs, or GPU allocation to operate. |
| Hosting & Deployment (Docker, K8s, serverless) | **Managed static hosting.** `server.js` (zero-dependency Node static file server) runs the preview; production deploys serve the same static output. No containers or orchestrators to run. |
| Version Control & CI/CD (Git, pipelines) | **GitHub** (`b3icedrage/GlitchIt`) + Freebuff-managed deploys. Pushes trigger preview and production deployments; no self-hosted CI runners. |

## Data & Storage

| Catalog item | GlitchIt today |
| --- | --- |
| Databases (Postgres, Redis…) | **Supabase Postgres.** The `media` table (owner, url, type, caption, title, likes…) is the source of truth for the home feed, glitches/reels, search accounts, creators, profile grids, shop storefronts, and saved videos. Accounts live in `auth.users`. |
| Object Storage (S3 buckets) | **Cloudinary (free tier).** Photos and videos are uploaded browser-direct via an unsigned upload preset (`src/config.js` → `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_UPLOAD_PRESET`) and served back through Cloudinary's CDN — 100 MB per file, 25 GB free storage. Until Cloudinary is configured, `src/db.js` falls back to the old **Supabase Storage** bucket (`glitchit-media`). |
| Caching (in-memory stores) | **Three HTTP/cache layers** (see CDN & Edge): `server.js` Cache-Control + ETag revalidation + gzip, the `sw.js` service worker (stale-while-revalidate), and Supabase's edge cache on stored media. No Redis needed at this scale. |

## Backend & Logic

| Catalog item | GlitchIt today |
| --- | --- |
| APIs & Services (business rules, auth) | **Supabase client SDK** consumed from `src/auth.js` (email/password auth, sessions, guest mode) and `src/db.js` (media CRUD, saved videos, creator queries). All app logic runs client-side for now. |
| Background Workers (queues, cron) | **None yet — deferred.** Video transcoding/posters, email digests, and cleanup jobs would be Supabase Edge Functions or a managed queue once the app has real traffic. |

## Frontend & Delivery

| Catalog item | GlitchIt today |
| --- | --- |
| Presentation Layer (web/mobile UI) | **Vanilla HTML/CSS/JS multi-page app** — home, search, glitches, messages, chat, live, activity, shop, profile, auth, and settings screens sharing one `src/main.js` (per-page hydration via `<body data-page>`). |
| CDN & Edge (cache assets close to users) | **Three layers**: (1) the hosting platform's CDN for static assets, (2) `sw.js` browser cache — precached app shell + stale-while-revalidate assets + budgeted Supabase image cache, with network-first navigations so deploys propagate instantly, (3) Supabase's CDN for uploaded media. Vendor libraries (supabase-js) are loaded from jsDelivr/esm.sh CDNs with multi-mirror fallbacks. |

## Network & Traffic Control

| Catalog item | GlitchIt today |
| --- | --- |
| Load Balancing | **Provided by the hosting platform** for production. `server.js` is single-instance and preview-only. |
| Rate Limiting & Firewalls (WAF) | **Two layers.** (1) The static server (`server.js`) throttles per IP — 300 req/min plus a 40 req/3s burst, answering with `429` + `Retry-After` when exceeded. (2) Providers manage the rest: Supabase enforces auth rate limits (e.g., email send caps, surfaced as friendly errors in `src/auth.js`) and the platform WAF fronts production traffic. |

## Security & Operations

| Catalog item | GlitchIt today |
| --- | --- |
| Identity & Access (RBAC, secrets) | **Supabase Auth** — email/password sign-up and sign-in, persisted sessions, and a read-only guest mode. Secrets are split: public client keys ship in `src/config.js` (Supabase URL/anon key, Sentry DSN); anything server-side would live in Freebuff-managed env keys. Next step: enable RLS policies on the `media` table so only owners can mutate their rows. |
| Logging & Error Tracking (Sentry, Datadog) | **Sentry** (browser error tracking + performance monitoring, 20% trace sampling) wired into `src/main.js`. A public DSN in `src/config.js` activates it. Global `error`/`unhandledrejection` capture forwards everything to Sentry; db/auth/service-worker failures report through the same hook; the signed-in user is tagged for error context. |
| Backup & Recovery (snapshots, failover) | **Managed by providers.** Supabase handles database and storage backups; Git history is the source-of-truth backup for the codebase. No self-managed snapshot tooling. |

---

## Deliberately not on the map yet

- Self-managed load balancing and WAF configuration (both handled by the hosting platform; per-IP rate limiting now lives in `server.js`)
- Background workers / message queues (transcoding, digests)
- Redis-class in-memory caching (HTTP + service-worker caching covers current scale)
- RBAC beyond Supabase Auth (add RLS policies first)
- Any self-hosted VMs, Kubernetes, or cloud provisioning

Each of these becomes relevant the moment GlitchIt grows a real backend API or
crosses into sustained traffic — and the current stack (Supabase + managed
hosting) slots straight into the catalog items above when that happens.
