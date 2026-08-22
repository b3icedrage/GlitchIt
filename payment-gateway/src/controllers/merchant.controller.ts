// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Merchant Controller
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from 'express';
import { db } from '../database/client.js';
import {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
} from '../utils/crypto.js';
import type { MerchantCreate, ApiResponse } from '../types/index.js';

/**
 * Merchant Controller
 *
 * Handles merchant registration and API key management.
 *
 * Endpoints:
 *   POST   /v1/merchants         — Register a new merchant
 *   POST   /v1/merchants/keys    — Generate/rotate API keys
 *   GET    /v1/merchants/me      — Get current merchant info
 *   GET    /v1/merchants/stats   — Get transaction statistics
 */
export class MerchantController {
  /**
   * POST /v1/merchants
   *
   * Register a new merchant and generate their API keys.
   * This is called once during merchant onboarding.
   *
   * Returns the secret key ONCE — it cannot be retrieved again.
   */
  async register(req: Request, res: Response): Promise<void> {
    const {
      name,
      email,
      phone_number,
      paybill_number,
      till_number,
      consumer_key,
      consumer_secret,
      passkey,
      shortcode,
      callback_url,
    } = req.body as Partial<MerchantCreate>;

    // ── Validate required fields ────────────────────────────────────
    const missing: string[] = [];
    if (!name) missing.push('name');
    if (!email) missing.push('email');
    if (!phone_number) missing.push('phone_number');
    if (!paybill_number) missing.push('paybill_number');
    if (!consumer_key) missing.push('consumer_key');
    if (!consumer_secret) missing.push('consumer_secret');
    if (!passkey) missing.push('passkey');
    if (!shortcode) missing.push('shortcode');
    if (!callback_url) missing.push('callback_url');

    if (missing.length > 0) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields',
        error: `Missing: ${missing.join(', ')}`,
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // ── Check email uniqueness ──────────────────────────────────────
    const existing = await db.merchant.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({
        success: false,
        message: 'Email already registered',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // ── Generate API keys ───────────────────────────────────────────
    const rawSecretKey = generateApiKey('sk', 'live');
    const secretKeyHash = await hashApiKey(rawSecretKey);

    // Derive public key from secret key
    const publicKey = rawSecretKey.replace(/^sk_live_/, 'pk_live_');
    const webhookSecret = generateWebhookSecret();

    // ── Create merchant ─────────────────────────────────────────────
    const merchant = await db.merchant.create({
      data: {
        name: name!,
        email: email!,
        phone_number: phone_number!,
        paybill_number: paybill_number!,
        till_number: till_number || null,
        consumer_key: consumer_key!,
        consumer_secret: consumer_secret!,
        passkey: passkey!,
        shortcode: shortcode!,
        api_key_public: publicKey,
        api_key_secret_hash: secretKeyHash,
        webhook_secret: webhookSecret,
        callback_url: callback_url!,
      },
    });

    // ── Log key creation ────────────────────────────────────────────
    await db.apiKeyLog.create({
      data: {
        merchant_id: merchant.id,
        action: 'created',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] || null,
      },
    });

    console.log(`[Merchant] Registered: ${merchant.name} (${merchant.id})`);

    // ── Return response (secret key shown ONCE) ─────────────────────
    res.status(201).json({
      success: true,
      message: 'Merchant registered successfully. Save your secret key — it cannot be retrieved again.',
      data: {
        merchant_id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        api_key_public: publicKey,
        api_key_secret: rawSecretKey, // ⚠️ SHOWN ONCE
        webhook_secret: webhookSecret,
        shortcode: merchant.shortcode,
        callback_url: merchant.callback_url,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }

  /**
   * POST /v1/merchants/keys/rotate
   *
   * Generate a new API key pair, revoking the old one.
   * Requires the current secret key for authentication.
   */
  async rotateKeys(req: Request, res: Response): Promise<void> {
    const merchant = req.merchant!;

    // Generate new keys
    const rawSecretKey = generateApiKey('sk', 'live');
    const secretKeyHash = await hashApiKey(rawSecretKey);
    const publicKey = rawSecretKey.replace(/^sk_live_/, 'pk_live_');

    // Update merchant with new keys
    await db.merchant.update({
      where: { id: merchant.id },
      data: {
        api_key_public: publicKey,
        api_key_secret_hash: secretKeyHash,
      },
    });

    // Log the rotation
    await db.apiKeyLog.create({
      data: {
        merchant_id: merchant.id,
        action: 'rotated',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] || null,
      },
    });

    console.log(`[Merchant] Keys rotated for ${merchant.name} (${merchant.id})`);

    res.status(200).json({
      success: true,
      message: 'API keys rotated. Old keys are immediately invalidated.',
      data: {
        api_key_public: publicKey,
        api_key_secret: rawSecretKey, // ⚠️ SHOWN ONCE
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }

  /**
   * GET /v1/merchants/me
   *
   * Get the authenticated merchant's profile (without sensitive fields).
   */
  async getProfile(req: Request, res: Response): Promise<void> {
    const merchant = req.merchant!;

    res.status(200).json({
      success: true,
      message: 'Merchant profile',
      data: {
        merchant_id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        phone_number: merchant.phone_number,
        paybill_number: merchant.paybill_number,
        shortcode: merchant.shortcode,
        api_key_public: merchant.api_key_public,
        callback_url: merchant.callback_url,
        is_active: merchant.is_active,
        created_at: merchant.created_at,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }

  /**
   * GET /v1/merchants/stats
   *
   * Get transaction statistics for the authenticated merchant.
   */
  async getStats(req: Request, res: Response): Promise<void> {
    const merchant = req.merchant!;

    const [total, successful, pending, failed] = await Promise.all([
      db.transaction.count({ where: { merchant_id: merchant.id } }),
      db.transaction.count({ where: { merchant_id: merchant.id, status: 'SUCCESSFUL' } }),
      db.transaction.count({ where: { merchant_id: merchant.id, status: 'PENDING' } }),
      db.transaction.count({ where: { merchant_id: merchant.id, status: 'FAILED' } }),
    ]);

    const totalRevenue = await db.transaction.aggregate({
      where: { merchant_id: merchant.id, status: 'SUCCESSFUL' },
      _sum: { amount: true },
    });

    res.status(200).json({
      success: true,
      message: 'Transaction statistics',
      data: {
        total_transactions: total,
        successful,
        pending,
        failed,
        total_revenue: Number(totalRevenue._sum.amount || 0),
        success_rate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : '0%',
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
}

export const merchantController = new MerchantController();
export default merchantController;
