// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Charges Controller
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from 'express';
import { stkPushService } from '../services/stk-push.service.js';
import { maskPhone } from '../utils/phone.js';
import type { ChargeRequest, ApiResponse } from '../types/index.js';

/**
 * Charges Controller
 *
 * Handles POST /v1/charges — the primary endpoint for merchants
 * to initiate M-Pesa Express (STK Push) payments.
 *
 * Requires authenticated merchant (middleware sets req.merchant).
 */
export class ChargesController {
  /**
   * POST /v1/charges
   *
   * Accept a simplified payment request from a merchant and initiate
   * an STK Push to the customer's phone.
   *
   * Request body:
   *   {
   *     "amount": 1500,
   *     "phone_number": "0712345678",
   *     "account_reference": "ORDER-123",     // optional
   *     "transaction_desc": "Shoe purchase"   // optional
   *   }
   *
   * Response (success):
   *   {
   *     "success": true,
   *     "message": "STK Push sent to customer's phone",
   *     "data": {
   *       "checkout_request_id": "ws_CO_...",
   *       "merchant_request_id": "...",
   *       "response_code": "0",
   *       "response_description": "Success. Request accepted for processing",
   *       "customer_message": "Success. Request accepted for processing"
   *     },
   *     "timestamp": "2026-08-20T12:00:00.000Z"
   *   }
   */
  async createCharge(req: Request, res: Response): Promise<void> {
    const merchant = req.merchant!; // Guaranteed by auth middleware

    // ── Parse and validate request body ─────────────────────────────
    const { amount, phone_number, account_reference, transaction_desc } =
      req.body as Partial<ChargeRequest>;

    // Basic validation before hitting the service
    if (!amount || !phone_number) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields',
        error: 'amount and phone_number are required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid amount',
        error: 'amount must be a positive number',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    if (typeof phone_number !== 'string' || phone_number.length < 9) {
      res.status(400).json({
        success: false,
        message: 'Invalid phone number',
        error: 'phone_number must be a valid Kenyan number (e.g., 0712345678)',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // ── Initiate STK Push ───────────────────────────────────────────
    const request: ChargeRequest = {
      amount: Math.round(amount),
      phone_number: phone_number.trim(),
      account_reference: account_reference || undefined,
      transaction_desc: transaction_desc || undefined,
    };

    console.log(
      `[Charges] Merchant=${merchant.name} → ` +
      `phone=${maskPhone(phone_number)} amount=${amount}`
    );

    const result = await stkPushService.initiatePayment(merchant, request);

    // ── Return response ─────────────────────────────────────────────
    const statusCode = result.success ? 200 : 400;

    res.status(statusCode).json({
      success: result.success,
      message: result.message,
      data: result.data,
      error: result.error,
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }

  /**
   * GET /v1/charges/:checkout_request_id
   *
   * Look up a transaction by its CheckoutRequestID.
   * Allows merchants to check the status of a payment.
   */
  async getChargeStatus(req: Request, res: Response): Promise<void> {
    const merchant = req.merchant!;
    const { checkout_request_id } = req.params;

    if (!checkout_request_id) {
      res.status(400).json({
        success: false,
        message: 'checkout_request_id is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // Import db here to avoid circular dependency
    const { db } = await import('../database/client.js');

    const transaction = await db.transaction.findUnique({
      where: { checkout_request_id },
    });

    if (!transaction || transaction.merchant_id !== merchant.id) {
      res.status(404).json({
        success: false,
        message: 'Transaction not found',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Transaction found',
      data: {
        checkout_request_id: transaction.checkout_request_id,
        amount: Number(transaction.amount),
        status: transaction.status,
        mpesa_receipt_number: transaction.mpesa_receipt_number,
        result_code: transaction.result_code,
        result_description: transaction.result_description,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
}

export const chargesController = new ChargesController();
export default chargesController;
