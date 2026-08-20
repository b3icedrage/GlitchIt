// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Application Entry Point
// ═══════════════════════════════════════════════════════════════════════
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { getRedisClient, closeRedis } from './config/redis.js';
import { db } from './database/client.js';
import { webhookWorker } from './workers/webhook.worker.js';
import routes from './routes/index.js';

const app = express();

// ─── Security Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*', // Restrict in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Mpesa-Signature'],
}));

// ─── Body Parsing ───────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logging ────────────────────────────────────────────────
app.use((req, _res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} — IP: ${req.ip}`);
  next();
});

// ─── Rate Limiting (in-memory, per-IP) ──────────────────────────────
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = config.rate_limit_window_ms;

  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(ip, bucket);
  }

  bucket.count++;

  if (bucket.count > config.rate_limit_max) {
    res.status(429).json({
      success: false,
      message: 'Rate limit exceeded',
      error: `Max ${config.rate_limit_max} requests per ${windowMs / 1000}s`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
});

// ─── Routes ─────────────────────────────────────────────────────────
app.use(routes);

// ─── Global Error Handler ───────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[App] Unhandled error:', err);

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// ─── Start Server ───────────────────────────────────────────────────
async function start() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  M-Pesa Express Gateway v1.0.0');
  console.log(`  Environment: ${config.node_env}`);
  console.log(`  Daraja: ${config.daraja_env}`);
  console.log('═══════════════════════════════════════════════════════');

  // Verify database connection
  try {
    await db.$connect();
    console.log('[DB] Connected to PostgreSQL');
  } catch (error) {
    console.error('[DB] Connection failed:', (error as Error).message);
    process.exit(1);
  }

  // Verify Redis connection
  try {
    const redis = getRedisClient();
    await redis.ping();
    console.log('[Redis] Connected');
  } catch (error) {
    console.error('[Redis] Connection failed:', (error as Error).message);
    process.exit(1);
  }

  // Initialize webhook worker
  try {
    await webhookWorker.initialize();
    console.log('[Worker] Webhook worker initialized');
  } catch (error) {
    console.error('[Worker] Initialization failed:', (error as Error).message);
    // Don't exit — server can still receive payments, just can't deliver webhooks
  }

  // Start listening
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[Server] Listening on http://0.0.0.0:${config.port}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET  /health                    — Health check`);
    console.log(`  POST /v1/merchants              — Register merchant`);
    console.log(`  POST /v1/charges                — Initiate STK Push`);
    console.log(`  GET  /v1/charges/:id            — Check charge status`);
    console.log(`  POST /v1/mpesa-callback         — Daraja callback`);
    console.log(`  GET  /v1/merchants/me           — Merchant profile`);
    console.log(`  GET  /v1/merchants/stats        — Transaction stats`);
    console.log(`  POST /v1/merchants/keys/rotate  — Rotate API keys`);
    console.log('');
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  await webhookWorker.shutdown();
  await closeRedis();
  await db.$disconnect();

  console.log('[Shutdown] Complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ──────────────────────────────────────────────────────────
start().catch((error) => {
  console.error('[Fatal]', error);
  process.exit(1);
});

export default app;
