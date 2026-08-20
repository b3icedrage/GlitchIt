// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Webhook Worker (BullMQ)
// ═══════════════════════════════════════════════════════════════════════
import { Queue, Worker, type Job } from 'bullmq';
import { getRedisClient } from '../config/redis.js';
import { db } from '../database/client.js';
import { signPayload } from '../utils/crypto.js';
import { maskPhone } from '../utils/phone.js';
import type { TransactionStatus, WebhookPayload } from '../types/index.js';

// ─── Queue Configuration ────────────────────────────────────────────
const QUEUE_NAME = 'webhook-delivery';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000; // 5 seconds between retries
const JOB_TIMEOUT_MS = 30_000;

// ─── Job Data ───────────────────────────────────────────────────────
export interface WebhookJobData {
  transactionId: string;
  merchantId: string;
  merchantName: string;
  merchantWebhookSecret: string;
  merchantCallbackUrl: string;
  checkoutRequestId: string;
  merchantRequestId: string;
  status: TransactionStatus;
  amount: number;
  phoneNumber: string;
  mpesaReceiptNumber: string | null;
  resultCode: number | null;
  resultDescription: string | null;
}

/**
 * Webhook Worker
 *
 * Background job processor that delivers payment notifications to merchants.
 * Uses BullMQ for reliable job processing with retries.
 *
 * Flow:
 *   1. Enqueue webhook job when transaction status changes
 *   2. Worker picks up job and builds the webhook payload
 *   3. Sign the payload with HMAC-SHA256 using the merchant's webhook secret
 *   4. POST the signed payload to the merchant's callback_url
 *   5. On success: mark webhook as delivered in PostgreSQL
 *   6. On failure: retry with exponential backoff (up to 5 times)
 *   7. After max retries: mark as failed in PostgreSQL
 */
class WebhookWorker {
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  /**
   * Initialize the BullMQ queue and worker.
   */
  async initialize(): Promise<void> {
    const redis = getRedisClient();

    // Create the queue
    this.queue = new Queue(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: MAX_RETRIES,
        backoff: {
          type: 'exponential',
          delay: RETRY_DELAY_MS,
        },
        removeOnComplete: { age: 86400 }, // Keep completed jobs for 24h
        removeOnFail: { age: 604800 },    // Keep failed jobs for 7 days
      },
    });

    // Create the worker
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<WebhookJobData>) => {
        return this.processWebhook(job);
      },
      {
        connection: redis,
        concurrency: 5,        // Process 5 webhooks in parallel
        lockDuration: JOB_TIMEOUT_MS,
      }
    );

    // Event handlers
    this.worker.on('completed', (job) => {
      console.log(`[Webhook] ✅ Delivered to ${job.data.merchantName} (job ${job.id})`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(
        `[Webhook] ❌ Failed (job ${job?.id}, attempt ${job?.attemptsMade}): ${err.message}`
      );
    });

    this.worker.on('error', (err) => {
      console.error('[Webhook] Worker error:', err.message);
    });

    console.log('[Webhook] Worker initialized');
  }

  /**
   * Enqueue a webhook delivery job.
   */
  async enqueue(data: WebhookJobData): Promise<string> {
    if (!this.queue) {
      throw new Error('Webhook worker not initialized');
    }

    const job = await this.queue.add('deliver', data, {
      jobId: `wh-${data.transactionId}-${Date.now()}`,
    });

    console.log(`[Webhook] Job enqueued: ${job.id} for merchant=${data.merchantName}`);
    return job.id || 'unknown';
  }

  /**
   * Process a single webhook delivery job.
   */
  private async processWebhook(job: Job<WebhookJobData>): Promise<string> {
    const data = job.data;

    // ── Step 1: Build the webhook payload ───────────────────────────
    const payload: Omit<WebhookPayload, 'signature'> = {
      event: this.getEventName(data.status),
      transaction_id: data.transactionId,
      merchant_id: data.merchantId,
      checkout_request_id: data.checkoutRequestId,
      amount: data.amount,
      phone_number: data.phoneNumber,
      mpesa_receipt_number: data.mpesaReceiptNumber,
      status: data.status,
      timestamp: new Date().toISOString(),
    };

    // ── Step 2: Sign the payload with HMAC-SHA256 ───────────────────
    const signature = signPayload(payload, data.merchantWebhookSecret);

    const signedPayload: WebhookPayload = {
      ...payload,
      signature,
    };

    // ── Step 3: POST to merchant's callback URL ─────────────────────
    const response = await fetch(data.merchantCallbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mpesa-Signature': signature,
        'X-Mpesa-Event': payload.event,
        'User-Agent': 'MpesaExpressGateway/1.0',
      },
      body: JSON.stringify(signedPayload),
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Webhook delivery failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    // ── Step 4: Mark as delivered in database ───────────────────────
    await db.transaction.update({
      where: { id: data.transactionId },
      data: {
        webhook_delivered: true,
        webhook_attempts: { increment: 1 },
      },
    });

    return `Delivered to ${data.merchantCallbackUrl}`;
  }

  /**
   * Get the event name for the webhook payload.
   */
  private getEventName(status: TransactionStatus): WebhookPayload['event'] {
    switch (status) {
      case 'SUCCESSFUL':
        return 'payment.successful';
      case 'CANCELLED':
        return 'payment.cancelled';
      default:
        return 'payment.failed';
    }
  }

  /**
   * Gracefully shut down the worker.
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.queue) {
      await this.queue.close();
    }
    console.log('[Webhook] Worker shut down');
  }
}

export const webhookWorker = new WebhookWorker();
export default webhookWorker;
