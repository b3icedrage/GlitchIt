// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Type Definitions
// ═══════════════════════════════════════════════════════════════════════

// ─── Merchant ───────────────────────────────────────────────────────
export interface Merchant {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  paybill_number: string;
  till_number: string | null;
  consumer_key: string;
  consumer_secret: string;
  passkey: string;
  shortcode: string;
  api_key_public: string;   // pk_live_... (shown in dashboard)
  api_key_secret_hash: string; // bcrypt hash of sk_live_...
  webhook_secret: string;    // used to sign outgoing webhooks
  callback_url: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MerchantCreate {
  name: string;
  email: string;
  phone_number: string;
  paybill_number: string;
  till_number?: string;
  consumer_key: string;
  consumer_secret: string;
  passkey: string;
  shortcode: string;
  callback_url: string;
}

// ─── Transaction ────────────────────────────────────────────────────
export type TransactionStatus =
  | 'PENDING'
  | 'STK_SENT'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

export interface Transaction {
  id: string;
  merchant_id: string;
  checkout_request_id: string;   // Safaricom's CheckoutRequestID
  merchant_request_id: string;   // Safaricom's MerchantRequestID
  amount: number;
  phone_number: string;
  account_reference: string;
  status: TransactionStatus;
  mpesa_receipt_number: string | null;
  result_code: number | null;
  result_description: string | null;
  stk_response_code: string | null;
  stk_response_description: string | null;
  webhook_delivered: boolean;
  webhook_attempts: number;
  created_at: Date;
  updated_at: Date;
}

// ─── Safaricom Daraja Types ─────────────────────────────────────────
export interface DarajaTokenResponse {
  access_config: {
    access_token: string;
    expires_in: string;
  };
}

export interface StkPushRequest {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
}

export interface StkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface DarajaStkCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

// ─── API Request/Response ───────────────────────────────────────────
export interface ChargeRequest {
  amount: number;
  phone_number: string;
  account_reference?: string;
  transaction_desc?: string;
}

export interface ChargeResponse {
  success: boolean;
  message: string;
  data?: {
    checkout_request_id: string;
    merchant_request_id: string;
    response_code: string;
    response_description: string;
    customer_message: string;
  };
  error?: string;
}

export interface WebhookPayload {
  event: 'payment.successful' | 'payment.failed' | 'payment.cancelled';
  transaction_id: string;
  merchant_id: string;
  checkout_request_id: string;
  amount: number;
  phone_number: string;
  mpesa_receipt_number: string | null;
  status: TransactionStatus;
  timestamp: string;
  signature: string; // HMAC-SHA256 of the payload body
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  timestamp: string;
}

// ─── Config ─────────────────────────────────────────────────────────
export interface AppConfig {
  port: number;
  node_env: string;
  database_url: string;
  redis_url: string;
  daraja_env: 'sandbox' | 'production';
  default_shortcode: string;
  default_passkey: string;
  webhook_secret: string;
  api_key_prefix: string;
  rate_limit_window_ms: number;
  rate_limit_max: number;
}
