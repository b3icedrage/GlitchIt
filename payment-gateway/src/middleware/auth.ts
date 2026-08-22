// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — API Key Authentication Middleware
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response, NextFunction } from 'express';
import { db } from '../database/client.js';
import { verifyApiKey } from '../utils/crypto.js';
import { maskPhone } from '../utils/phone.js';
import type { Merchant } from '../types/index.js';

// Extend Express Request to include authenticated merchant
declare global {
  namespace Express {
    interface Request {
      merchant?: Merchant;
      merchantId?: string;
    }
  }
}

/**
 * Authenticate incoming requests by verifying the Bearer token
 * against the merchants table.
 *
 * Flow:
 *   1. Extract `Authorization: Bearer sk_live_...` header
 *   2. Look up merchant by api_key_public (extracted from the key prefix)
 *   3. Verify the full secret key against the bcrypt hash
 *   4. Attach the merchant to the request object
 *   5. Reject with 401 if any step fails
 */
export async function authenticateMerchant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ── Step 1: Extract the bearer token ────────────────────────────
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Missing or invalid Authorization header',
        error: 'Expected: Bearer <api_key>',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const apiKey = authHeader.slice(7).trim();

    if (!apiKey || apiKey.length < 20) {
      res.status(401).json({
        success: false,
        message: 'Invalid API key format',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Step 2: Find merchant by public key ─────────────────────────
    // The public key (pk_live_...) is stored in the DB and allows O(1) lookup.
    // The secret key (sk_live_...) is what the merchant sends — we verify
    // it against the bcrypt hash.
    //
    // In our key scheme, pk and sk share the same random suffix.
    // So we derive the public key from the secret for the lookup.
    const publicKey = derivePublicKey(apiKey);

    const merchant = await db.merchant.findUnique({
      where: { api_key_public: publicKey },
    });

    if (!merchant) {
      res.status(401).json({
        success: false,
        message: 'Invalid API key',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Step 3: Check merchant is active ────────────────────────────
    if (!merchant.is_active) {
      res.status(403).json({
        success: false,
        message: 'Merchant account is suspended',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Step 4: Verify the secret key against bcrypt hash ───────────
    const isValid = await verifyApiKey(apiKey, merchant.api_key_secret_hash);

    if (!isValid) {
      // Log the failed attempt
      console.warn(
        `[Auth] Failed key verification for merchant ${merchant.id} ` +
        `from ${req.ip} — ${req.headers['user-agent']}`
      );

      res.status(401).json({
        success: false,
        message: 'Invalid API key',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Step 5: Attach merchant to request ──────────────────────────
    req.merchant = merchant;
    req.merchantId = merchant.id;

    // Continue to the route handler
    next();
  } catch (error) {
    console.error('[Auth] Middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication service unavailable',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Derive the public key from a secret key.
 * sk_live_abc123... → pk_live_abc123...
 *
 * Both keys share the same random suffix; only the prefix differs.
 */
function derivePublicKey(secretKey: string): string {
  return secretKey.replace(/^sk_live_/, 'pk_live_').replace(/^sk_test_/, 'pk_test_');
}

/**
 * Optional middleware: log all authenticated requests for audit trail.
 */
export function logRequest(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const merchant = req.merchant;
  if (merchant) {
    console.log(
      `[API] ${req.method} ${req.path} ` +
      `merchant=${merchant.name} ` +
      `ip=${req.ip}`
    );
  }
  next();
}

export default authenticateMerchant;
