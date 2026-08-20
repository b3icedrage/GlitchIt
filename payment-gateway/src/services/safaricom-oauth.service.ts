// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Safaricom OAuth Service (Redis-Cached)
// ═══════════════════════════════════════════════════════════════════════
import { getRedisClient } from '../config/redis.js';
import { DARAJA_BASE_URL } from '../config/index.js';
import { generateBasicAuth } from '../utils/crypto.js';
import type { DarajaTokenResponse } from '../types/index.js';

const TOKEN_CACHE_KEY_PREFIX = 'mpesa:oauth:';
const TOKEN_CACHE_TTL_SECONDS = 3500; // Safaricom tokens last 3600s; cache for ~58 min

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Safaricom OAuth Service
 *
 * Handles the OAuth 2.0 token exchange with Safaricom's Daraja API.
 * Tokens are cached in Redis to avoid redundant API calls.
 *
 * Flow:
 *   1. Check Redis for a cached token
 *   2. If cache hit → return immediately (no API call)
 *   3. If cache miss → POST to Daraja /oauth/v1/generate
 *   4. Cache the new token in Redis with 3500s TTL
 *   5. Return the token
 */
export class SafaricomOAuthService {
  /**
   * Get a valid OAuth access token.
   * Uses Redis caching to minimize Daraja API calls.
   *
   * @param consumerKey - Daraja consumer key
   * @param consumerSecret - Daraja consumer secret
   * @returns Valid access token string
   * @throws Error if token generation fails after retries
   */
  async getAccessToken(
    consumerKey: string,
    consumerSecret: string
  ): Promise<string> {
    const cacheKey = this.getCacheKey(consumerKey);

    // ── Step 1: Check Redis cache ──────────────────────────────────
    try {
      const redis = getRedisClient();
      const cachedToken = await redis.get(cacheKey);

      if (cachedToken) {
        console.log(`[OAuth] Cache hit for consumer=${this.maskKey(consumerKey)}`);
        return cachedToken;
      }
    } catch (err) {
      // Redis unavailable — proceed without cache (don't fail the request)
      console.warn('[Redis] Cache read failed, fetching fresh token:', (err as Error).message);
    }

    // ── Step 2: Fetch new token from Daraja ────────────────────────
    const token = await this.fetchTokenWithRetry(consumerKey, consumerSecret);

    // ── Step 3: Cache in Redis ─────────────────────────────────────
    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, token, 'EX', TOKEN_CACHE_TTL_SECONDS);
      console.log(
        `[OAuth] Token cached for consumer=${this.maskKey(consumerKey)} ` +
        `TTL=${TOKEN_CACHE_TTL_SECONDS}s`
      );
    } catch (err) {
      // Redis write failed — token still works, just won't be cached
      console.warn('[Redis] Cache write failed:', (err as Error).message);
    }

    return token;
  }

  /**
   * Invalidate a cached token (e.g., after receiving an "invalid token" response).
   */
  async invalidateToken(consumerKey: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const cacheKey = this.getCacheKey(consumerKey);
      await redis.del(cacheKey);
      console.log(`[OAuth] Invalidated token cache for consumer=${this.maskKey(consumerKey)}`);
    } catch (err) {
      console.warn('[Redis] Cache invalidation failed:', (err as Error).message);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Fetch token with exponential backoff retry.
   */
  private async fetchTokenWithRetry(
    consumerKey: string,
    consumerSecret: string,
    attempt: number = 1
  ): Promise<string> {
    try {
      const basicAuth = generateBasicAuth(consumerKey, consumerSecret);
      const url = `${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;

      console.log(
        `[OAuth] Requesting token (attempt ${attempt}/${MAX_RETRIES}) ` +
        `for consumer=${this.maskKey(consumerKey)}`
      );

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${basicAuth}`,
        },
        signal: AbortSignal.timeout(15_000), // 15s timeout
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Daraja OAuth HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as DarajaTokenResponse;

      const token = data.access_config?.access_token;
      if (!token) {
        throw new Error('No access_token in Daraja response');
      }

      return token;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[OAuth] Attempt ${attempt} failed: ${(error as Error).message}. ` +
          `Retrying in ${delay}ms...`
        );
        await sleep(delay);
        return this.fetchTokenWithRetry(consumerKey, consumerSecret, attempt + 1);
      }

      throw new Error(
        `Failed to obtain Daraja OAuth token after ${MAX_RETRIES} attempts: ` +
        (error as Error).message
      );
    }
  }

  private getCacheKey(consumerKey: string): string {
    // Hash the consumer key to create a safe Redis key
    const hash = require('crypto')
      .createHash('sha256')
      .update(consumerKey)
      .digest('hex')
      .slice(0, 16);
    return `${TOKEN_CACHE_KEY_PREFIX}${hash}`;
  }

  private maskKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const safaricomOAuth = new SafaricomOAuthService();
export default safaricomOAuth;
