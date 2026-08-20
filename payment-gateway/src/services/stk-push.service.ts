// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — STK Push Service
// ═══════════════════════════════════════════════════════════════════════
import { DARAJA_BASE_URL } from '../config/index.js';
import { db } from '../database/client.js';
import { safaricomOAuth } from './safaricom-oauth.service.js';
import {
  generateTimestamp,
  generateStkPassword,
} from '../utils/crypto.js';
import { formatPhoneForDaraja, isValidKenyanPhone } from '../utils/phone.js';
import type {
  Merchant,
  Transaction,
  StkPushRequest,
  StkPushResponse,
  ChargeRequest,
  ChargeResponse,
} from '../types/index.js';

const STK_PUSH_ENDPOINT = '/mpesa/stkpush/v1/processrequest';
const STK_PUSH_TIMEOUT_MS = 30_000;

/**
 * STK Push Service
 *
 * Handles the full lifecycle of an M-Pesa Express (STK Push) payment:
 *   1. Validate merchant request
 *   2. Generate Daraja-specific fields (Timestamp, Password)
 *   3. Obtain OAuth token (from Redis cache or Daraja API)
 *   4. Fire STK Push request to Safaricom
 *   5. Log the transaction in PostgreSQL
 *   6. Return response to merchant
 */
export class StkPushService {
  /**
   * Initiate an STK Push payment.
   *
   * @param merchant - Authenticated merchant from middleware
   * @param request - Simplified charge request from merchant
   * @returns ChargeResponse with STK push result
   */
  async initiatePayment(
    merchant: Merchant,
    request: ChargeRequest
  ): Promise<ChargeResponse> {
    // ── Step 1: Validate input ──────────────────────────────────────
    const validationError = this.validateRequest(request);
    if (validationError) {
      return {
        success: false,
        message: 'Validation failed',
        error: validationError,
      };
    }

    const formattedPhone = formatPhoneForDaraja(request.phone_number);
    const amount = Math.round(request.amount); // Daraja requires integer amounts
    const accountRef = request.account_reference || `TXN-${Date.now()}`;
    const txDesc = request.transaction_desc || 'M-Pesa Payment';

    // ── Step 2: Generate Daraja-specific fields ─────────────────────
    const timestamp = generateTimestamp();
    const password = generateStkPassword(
      merchant.shortcode,
      merchant.passkey,
      timestamp
    );

    // ── Step 3: Get OAuth token ─────────────────────────────────────
    let accessToken: string;
    try {
      accessToken = await safaricomOAuth.getAccessToken(
        merchant.consumer_key,
        merchant.consumer_secret
      );
    } catch (error) {
      console.error(`[STK] OAuth failed for merchant ${merchant.id}:`, (error as Error).message);
      return {
        success: false,
        message: 'Payment gateway authentication failed',
        error: 'Unable to authenticate with payment provider',
      };
    }

    // ── Step 4: Build STK Push request ─────────────────────────────
    const stkPayload: StkPushRequest = {
      BusinessShortCode: merchant.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: merchant.shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: merchant.callback_url,
      AccountReference: accountRef.slice(0, 12), // Daraja max 12 chars
      TransactionDesc: txDesc.slice(0, 13),       // Daraja max 13 chars
    };

    console.log(
      `[STK] Initiating for merchant=${merchant.id} ` +
      `phone=${formattedPhone} amount=${amount} ref=${accountRef}`
    );

    // ── Step 5: Fire STK Push to Daraja ────────────────────────────
    let stkResponse: StkPushResponse;
    try {
      const response = await fetch(
        `${DARAJA_BASE_URL}${STK_PUSH_ENDPOINT}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(stkPayload),
          signal: AbortSignal.timeout(STK_PUSH_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Daraja STK Push HTTP ${response.status}: ${body}`);
      }

      stkResponse = (await response.json()) as StkPushResponse;
    } catch (error) {
      console.error(`[STK] Request failed:`, (error as Error).message);

      // If 401, invalidate the cached token for next attempt
      if ((error as Error).message.includes('401')) {
        await safaricomOAuth.invalidateToken(merchant.consumer_key);
      }

      return {
        success: false,
        message: 'STK Push request failed',
        error: 'Payment provider returned an error. Please try again.',
      };
    }

    // ── Step 6: Check Daraja response ──────────────────────────────
    if (stkResponse.ResponseCode !== '0') {
      console.warn(
        `[STK] Daraja rejected: code=${stkResponse.ResponseCode} ` +
        `desc=${stkResponse.ResponseDescription}`
      );

      // Still log the failed attempt
      await this.logTransaction(merchant.id, {
        phone_number: formattedPhone,
        amount,
        account_reference: accountRef,
        checkout_request_id: stkResponse.CheckoutRequestID || `FAIL-${Date.now()}`,
        merchant_request_id: stkResponse.MerchantRequestID || '',
        status: 'FAILED',
        stk_response_code: stkResponse.ResponseCode,
        stk_response_description: stkResponse.ResponseDescription,
      });

      return {
        success: false,
        message: stkResponse.ResponseDescription || 'STK Push was rejected',
        error: `Daraja response code: ${stkResponse.ResponseCode}`,
      };
    }

    // ── Step 7: Log successful STK dispatch ────────────────────────
    await this.logTransaction(merchant.id, {
      phone_number: formattedPhone,
      amount,
      account_reference: accountRef,
      checkout_request_id: stkResponse.CheckoutRequestID,
      merchant_request_id: stkResponse.MerchantRequestID,
      status: 'STK_SENT',
      stk_response_code: stkResponse.ResponseCode,
      stk_response_description: stkResponse.ResponseDescription,
    });

    console.log(
      `[STK] ✅ Sent to ${formattedPhone} — ` +
      `CheckoutRequestID=${stkResponse.CheckoutRequestID}`
    );

    // ── Step 8: Return success response ─────────────────────────────
    return {
      success: true,
      message: stkResponse.CustomerMessage || 'STK Push sent successfully',
      data: {
        checkout_request_id: stkResponse.CheckoutRequestID,
        merchant_request_id: stkResponse.MerchantRequestID,
        response_code: stkResponse.ResponseCode,
        response_description: stkResponse.ResponseDescription,
        customer_message: stkResponse.CustomerMessage,
      },
    };
  }

  // ─── Private ──────────────────────────────────────────────────────

  private validateRequest(request: ChargeRequest): string | null {
    if (!request.amount || request.amount <= 0) {
      return 'Amount must be a positive number';
    }

    if (request.amount > 150000) {
      return 'Amount cannot exceed KES 150,000 per transaction';
    }

    if (!request.phone_number) {
      return 'Phone number is required';
    }

    if (!isValidKenyanPhone(request.phone_number)) {
      return 'Invalid Kenyan phone number. Must be a Safaricom number (07XX or 01XX)';
    }

    return null;
  }

  private async logTransaction(
    merchantId: string,
    data: {
      phone_number: string;
      amount: number;
      account_reference: string;
      checkout_request_id: string;
      merchant_request_id: string;
      status: string;
      stk_response_code?: string;
      stk_response_description?: string;
    }
  ): Promise<void> {
    try {
      await db.transaction.create({
        data: {
          merchant_id: merchantId,
          phone_number: data.phone_number,
          amount: data.amount,
          account_reference: data.account_reference,
          checkout_request_id: data.checkout_request_id,
          merchant_request_id: data.merchant_request_id,
          status: data.status,
          stk_response_code: data.stk_response_code || null,
          stk_response_description: data.stk_response_description || null,
        },
      });
    } catch (error) {
      // Database write failed — log but don't crash the request
      console.error('[STK] Failed to log transaction:', (error as Error).message);
    }
  }
}

export const stkPushService = new StkPushService();
export default stkPushService;
