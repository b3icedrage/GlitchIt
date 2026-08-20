// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Callback Controller
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from 'express';
import { callbackService } from '../services/callback.service.js';
import type { DarajaStkCallback } from '../types/index.js';

/**
 * Callback Controller
 *
 * Handles the async callback from Safaricom after an STK Push.
 * This endpoint is NOT authenticated with our API keys —
 * Safaricom's servers hit it directly. Security is handled by:
 *   1. The callback URL is HTTPS-only (enforced by Daraja)
 *   2. We validate the CheckoutRequestID exists in our database
 *   3. We don't rely on phone numbers (Safaricom may mask them)
 *
 * Endpoints:
 *   POST /v1/mpesa-callback — Daraja STK Push callback
 */
export class CallbackController {
  /**
   * POST /v1/mpesa-callback
   *
   * Safaricom sends the STK Push result here asynchronously.
   * The body structure:
   *
   * {
   *   "Body": {
   *     "stkCallback": {
   *       "MerchantRequestID": "...",
   *       "CheckoutRequestID": "ws_CO_...",
   *       "ResultCode": 0,
   *       "ResultDesc": "The service request is processed successfully.",
   *       "CallbackMetadata": {
   *         "Item": [
   *           { "Name": "Amount", "Value": 1500 },
   *           { "Name": "MpesaReceiptNumber", "Value": "QHK71G4YS0" },
   *           { "Name": "Balance" },
   *           { "Name": "TransactionDate", "Value": 20260820120000 },
   *           { "Name": "PhoneNumber", "Value": 254712345678 }
   *         ]
   *       }
   *     }
   *   }
   * }
   */
  async handleDarajaCallback(req: Request, res: Response): Promise<void> {
    console.log('[Callback] Received Daraja callback');

    // ── Step 1: Validate body structure ─────────────────────────────
    const body = req.body as DarajaStkCallback;

    if (!body?.Body?.stkCallback) {
      console.warn('[Callback] Invalid callback structure — missing stkCallback');
      // Always return 200 to Safaricom to prevent retries
      res.status(200).json({ ResultCode: 0, ResultDesc: 'OK' });
      return;
    }

    const { stkCallback } = body.Body;

    console.log(
      `[Callback] CheckoutRequestID=${stkCallback.CheckoutRequestID} ` +
      `ResultCode=${stkCallback.ResultCode} ` +
      `ResultDesc=${stkCallback.ResultDesc}`
    );

    // ── Step 2: Process through callback service ────────────────────
    try {
      const success = await callbackService.processCallback(body);

      if (success) {
        console.log(`[Callback] ✅ Processed successfully`);
      } else {
        console.warn(`[Callback] ⚠️ Could not process (transaction not found or error)`);
      }
    } catch (error) {
      console.error('[Callback] Processing error:', (error as Error).message);
    }

    // ── Step 3: Always return 200 to Safaricom ─────────────────────
    // Returning non-200 causes Safaricom to retry the callback,
    // which can lead to duplicate processing.
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully',
    });
  }

  /**
   * POST /v1/test-callback
   *
   * Test endpoint to simulate a Daraja callback (for development/testing).
   * Only available in development mode.
   */
  async handleTestCallback(req: Request, res: Response): Promise<void> {
    if (process.env.NODE_ENV !== 'development') {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const { checkout_request_id, result_code = 0 } = req.body;

    if (!checkout_request_id) {
      res.status(400).json({ error: 'checkout_request_id is required' });
      return;
    }

    // Build a mock Daraja callback
    const mockCallback: DarajaStkCallback = {
      Body: {
        stkCallback: {
          MerchantRequestID: `test-mrid-${Date.now()}`,
          CheckoutRequestID: checkout_request_id,
          ResultCode: result_code,
          ResultDesc: result_code === 0
            ? 'The service request is processed successfully.'
            : 'Request cancelled by user.',
          CallbackMetadata: result_code === 0
            ? {
                Item: [
                  { Name: 'Amount', Value: 1500 },
                  { Name: 'MpesaReceiptNumber', Value: `TEST${Date.now().toString(36).toUpperCase()}` },
                  { Name: 'Balance' },
                  { Name: 'TransactionDate', Value: Number(new Date().toISOString().slice(0, 14)) },
                  { Name: 'PhoneNumber', Value: 254712345678 },
                ],
              }
            : undefined,
        },
      },
    };

    await callbackService.processCallback(mockCallback);

    res.status(200).json({
      success: true,
      message: 'Test callback processed',
      checkout_request_id,
      result_code,
    });
  }
}

export const callbackController = new CallbackController();
export default callbackController;
