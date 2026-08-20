// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Cryptographic Utilities
// ═══════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;
const API_KEY_BYTES = 32;
const HMAC_ALGORITHM = 'sha256';

// ─── API Key Generation ─────────────────────────────────────────────

/**
 * Generate a cryptographically secure API key.
 * Format: {prefix}_{environment}_{random}
 * Example: sk_live_a1b2c3d4e5f6...
 */
export function generateApiKey(
  prefix: string = 'mpesagw',
  environment: 'live' | 'test' = 'live'
): string {
  const random = crypto.randomBytes(API_KEY_BYTES).toString('hex');
  return `${prefix}_${environment}_${random}`;
}

/**
 * Generate a webhook signing secret for a merchant.
 * This secret is used to HMAC-sign outgoing webhook payloads.
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Hash an API key using bcrypt before storing in the database.
 * We never store plaintext secret keys.
 */
export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, SALT_ROUNDS);
}

/**
 * Verify an API key against its bcrypt hash.
 * Returns true if the key matches the stored hash.
 */
export async function verifyApiKey(
  providedKey: string,
  storedHash: string
): Promise<boolean> {
  return bcrypt.compare(providedKey, storedHash);
}

// ─── HMAC Signature ─────────────────────────────────────────────────

/**
 * Sign a payload with HMAC-SHA256 using the merchant's webhook secret.
 * Used when delivering webhooks to merchants.
 */
export function signPayload(
  payload: Record<string, unknown>,
  secret: string
): string {
  const body = JSON.stringify(payload);
  return crypto.createHmac(HMAC_ALGORITHM, secret).update(body).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature against a payload.
 * Used by merchants to verify incoming webhooks from our platform.
 */
export function verifySignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string
): boolean {
  const expected = signPayload(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

// ─── Daraja-Specific ────────────────────────────────────────────────

/**
 * Generate the YYYYMMDDHHmmss timestamp required by Daraja API.
 */
export function generateTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`
  );
}

/**
 * Generate the Base64 password for Daraja STK Push.
 * Password = Base64(Shortcode + Passkey + Timestamp)
 */
export function generateStkPassword(
  shortcode: string,
  passkey: string,
  timestamp: string
): string {
  const raw = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(raw).toString('base64');
}

/**
 * Generate Basic Auth header for Daraja OAuth.
 * BasicAuth = Base64(ConsumerKey:ConsumerSecret)
 */
export function generateBasicAuth(
  consumerKey: string,
  consumerSecret: string
): string {
  return Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
}
