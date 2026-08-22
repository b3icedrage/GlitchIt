// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Callback Service
// ═══════════════════════════════════════════════════════════════════════
import { db } from '../database/client.js';
import { webhookWorker } from '../workers/webhook.worker.js';
import type { DarajaStkCallback, TransactionStatus } from '../types/index.js';

/**
 * Callback Service
 *
 * Processes the async callback from Safaricom after an STK Push.
 * Safaricom hits our callback endpoint with the transaction result.
 *
 * IMPORTANT: Safaricom masks phone numbers in callback data for privacy.
 * We rely on CheckoutRequestID (unique per transaction) for matching,
 * NOT on phone numbers.
 *
 * Flow:
 *   1. Parse the stkCallback payload
 *   2. Find the transaction by CheckoutRequestID
 *   3. Extract metadata (receipt number, amount, etc.)
 *   4. Update transaction status in PostgreSQL
 *   5. Queue a webhook to the merchant via BullMQ
 */
export class CallbackService {
  /**
   * Process a Daraja STK Push callback.
   *
   * @param callbackBody - Raw callback body from Safaricom
   * @returns boolean indicating success
   */
  async processCallback(callbackBody: DarajaStkCallback): Promise<boolean> {
    const stkCallback = callbackBody.Body?.stkCallback;

    if (!stkCallback) {
      console.error('[Callback] Missing stkCallback in payload');
      return false;
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
    } = stkCallback;

    console.log(
      `[Callback] Received: CheckoutRequestID=${CheckoutRequestID} ` +
      `ResultCode=${ResultCode}`
    );

    // ── Step 1: Find the transaction by CheckoutRequestID ───────────
    const transaction = await db.transaction.findUnique({
      where: { checkout_request_id: CheckoutRequestID },
      include: { merchant: true },
    });

    if (!transaction) {
      console.warn(
        `[Callback] No transaction found for CheckoutRequestID=${CheckoutRequestID}. ` +
        `This may be a duplicate or orphaned callback.`
      );
      return false;
    }

    // ── Step 2: Determine status ────────────────────────────────────
    const status = this.getResultStatus(ResultCode);

    // ── Step 3: Extract metadata from CallbackMetadata ──────────────
    let mpesaReceiptNumber: string | null = null;
    let transactionAmount: number | null = null;

    if (stkCallback.CallbackMetadata?.Item) {
      for (const item of stkCallback.CallbackMetadata.Item) {
        if (item.Name === 'MpesaReceiptNumber') {
          mpesaReceiptNumber = String(item.Value);
        }
        if (item.Name === 'Amount') {
          transactionAmount = Number(item.Value);
        }
      }
    }

    // ── Step 4: Update transaction in PostgreSQL ─────────────────────
    try {
      await db.transaction.update({
        where: { checkout_request_id: CheckoutRequestID },
        data: {
          status,
          result_code: ResultCode,
          result_description: ResultDesc,
          mpesa_receipt_number: mpesaReceiptNumber,
          // Note: We do NOT update phone_number from callback data
          // because Safaricom may mask it. The original number is preserved.
        },
      });

      console.log(
        `[Callback] ✅ Transaction ${transaction.id} → ${status} ` +
        `receipt=${mpesaReceiptNumber || 'N/A'}`
      );
    } catch (error) {
      console.error(
        `[Callback] Failed to update transaction ${transaction.id}:`,
        (error as Error).message
      );
      return false;
    }

    // ── Step 5: Queue webhook to merchant ───────────────────────────
    if (transaction.merchant.callback_url) {
      try {
        await webhookWorker.enqueue({
          transactionId: transaction.id,
          merchantId: transaction.merchant_id,
          merchantName: transaction.merchant.name,
          merchantWebhookSecret: transaction.merchant.webhook_secret,
          merchantCallbackUrl: transaction.merchant.callback_url,
          checkoutRequestId: CheckoutRequestID,
          merchantRequestId: MerchantRequestID,
          status,
          amount: Number(transaction.amount),
          phoneNumber: transaction.phone_number, // Original, unmasked
          mpesaReceiptNumber,
          resultCode: ResultCode,
          resultDescription: ResultDesc,
        });

        console.log(
          `[Callback] Webhook queued for merchant=${transaction.merchant.name} ` +
          `url=${transaction.merchant.callback_url}`
        );
      } catch (error) {
        console.error(
          `[Callback] Failed to queue webhook:`,
          (error as Error).message
        );
      }
    }

    return true;
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Map Daraja ResultCode to our TransactionStatus.
   *
   * Daraja ResultCodes:
   *   0     = Success
   *   1032  = Request cancelled by user
   *   1037  = DS timeout (user didn't respond)
   *   1     = Insufficient balance
   *   2001  = Wrong credentials
   *   Others = Various failures
   */
  private getResultStatus(resultCode: number): TransactionStatus {
    switch (resultCode) {
      case 0:
        return 'SUCCESSFUL';
      case 1032:
        return 'CANCELLED';
      case 1037:
        return 'TIMEOUT';
      case 1:
      case 2001:
        return 'FAILED';
      default:
        return 'FAILED';
    }
  }
}

export const callbackService = new CallbackService();
export default callbackService;
