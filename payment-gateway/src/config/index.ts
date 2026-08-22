// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Configuration
// ═══════════════════════════════════════════════════════════════════════
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../types/index.js';

// Load env from parent directory's .env.local (Freebuff sets env vars there)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../..', '.env.local') });
dotenv.config({ path: join(__dirname, '../..', '.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config: AppConfig = {
  port: Number(optional('GATEWAY_PORT', '3000')),
  node_env: optional('GATEWAY_NODE_ENV', 'development'),
  database_url: required('DATABASE_URL'),
  redis_url: required('REDIS_URL'),
  daraja_env: (optional('GATEWAY_DARAJA_ENV', 'sandbox') as 'sandbox' | 'production'),
  default_shortcode: optional('GATEWAY_DARAJA_SHORTCODE', '174379'),
  default_passkey: optional('GATEWAY_DARAJA_PASSKEY', ''),
  webhook_secret: required('GATEWAY_WEBHOOK_SECRET'),
  api_key_prefix: optional('API_KEY_PREFIX', 'mpesagw'),
  rate_limit_window_ms: Number(optional('RATE_LIMIT_WINDOW_MS', '60000')),
  rate_limit_max: Number(optional('RATE_LIMIT_MAX', '100')),
};

export const DARAJA_BASE_URL =
  config.daraja_env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

export default config;
