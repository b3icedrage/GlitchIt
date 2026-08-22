# M-Pesa Express Gateway

White-label payment gateway wrapper around Safaricom's M-Pesa Daraja 3.0 API (STK Push / Lipa Na M-Pesa Online).

Third-party merchants sign up, get their own API keys, and process M-Pesa payments through your platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Merchant's App                                             │
│  Authorization: Bearer sk_live_...                          │
└──────────────┬──────────────────────────────────────────────┘
               │ POST /v1/charges
               ▼
┌─────────────────────────────────────────────────────────────┐
│  API Gateway Layer                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Rate Limiter │→ │ Auth Middle  │→ │ Charges Controller│  │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘  │
└─────────────────────────────────────────────────────────────┘
                                                │
               ┌────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Service Layer                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ SafaricomOAuth    │  │ STKPushService                   │ │
│  │ (Redis-cached)   │  │ (Daraja STK Push)                │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Data Layer                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ PostgreSQL   │  │ Redis        │  │ BullMQ Worker    │  │
│  │ (Prisma ORM) │  │ (Token Cache)│  │ (Webhook Relay)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install dependencies

```bash
cd payment-gateway
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Set up database

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push
```

### 4. Start the server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## API Reference

### Authentication

All authenticated endpoints require an `Authorization` header:

```
Authorization: Bearer sk_live_a1b2c3d4e5f6...
```

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `POST` | `/v1/merchants` | No | Register a new merchant |
| `POST` | `/v1/charges` | Yes | Initiate STK Push payment |
| `GET` | `/v1/charges/:checkout_request_id` | Yes | Check charge status |
| `POST` | `/v1/mpesa-callback` | No | Daraja callback (Safaricom) |
| `GET` | `/v1/merchants/me` | Yes | Get merchant profile |
| `GET` | `/v1/merchants/stats` | Yes | Transaction statistics |
| `POST` | `/v1/merchants/keys/rotate` | Yes | Rotate API keys |

### POST /v1/merchants — Register Merchant

```bash
curl -X POST http://localhost:3000/v1/merchants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Shop",
    "email": "shop@example.com",
    "phone_number": "0712345678",
    "paybill_number": "123456",
    "consumer_key": "your_daraja_consumer_key",
    "consumer_secret": "your_daraja_consumer_secret",
    "passkey": "your_daraja_passkey",
    "shortcode": "174379",
    "callback_url": "https://myapp.com/webhooks/mpesa"
  }'
```

Response (save the secret key — shown once):
```json
{
  "success": true,
  "message": "Merchant registered successfully. Save your secret key — it cannot be retrieved again.",
  "data": {
    "merchant_id": "uuid",
    "name": "My Shop",
    "api_key_public": "pk_live_a1b2c3...",
    "api_key_secret": "sk_live_a1b2c3...",  // ⚠️ Save this!
    "webhook_secret": "whsec_...",
    "shortcode": "174379",
    "callback_url": "https://myapp.com/webhooks/mpesa"
  }
}
```

### POST /v1/charges — Initiate STK Push

```bash
curl -X POST http://localhost:3000/v1/charges \
  -H "Authorization: Bearer sk_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1500,
    "phone_number": "0712345678",
    "account_reference": "ORDER-123",
    "transaction_desc": "Shoe purchase"
  }'
```

Response:
```json
{
  "success": true,
  "message": "STK Push sent to customer'\''s phone",
  "data": {
    "checkout_request_id": "ws_CO_123456789...",
    "merchant_request_id": "9210-123456789...",
    "response_code": "0",
    "response_description": "Success. Request accepted for processing",
    "customer_message": "Success. Request accepted for processing"
  }
}
```

### Webhook Payload

After the customer completes or fails the payment, Safaricom hits your callback endpoint, and our worker forwards a signed webhook to the merchant:

```json
{
  "event": "payment.successful",
  "transaction_id": "uuid",
  "merchant_id": "uuid",
  "checkout_request_id": "ws_CO_...",
  "amount": 1500,
  "phone_number": "254712345678",
  "mpesa_receipt_number": "QHK71G4YS0",
  "status": "SUCCESSFUL",
  "timestamp": "2026-08-20T12:00:00.000Z",
  "signature": "hmac-sha256-signature"
}
```

Merchants verify the `signature` using their `webhook_secret`:
```
expected = HMAC-SHA256(JSON.stringify(body), webhook_secret)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `WEBHOOK_SECRET` | ✅ | Master webhook signing secret |
| `PORT` | ❌ | Server port (default: 3000) |
| `NODE_ENV` | ❌ | development/production |
| `DARAJA_ENV` | ❌ | sandbox/production (default: sandbox) |
| `DARAJA_SHORTCODE` | ❌ | Default shortcode for sandbox |
| `DARAJA_PASSKEY` | ❌ | Default passkey for sandbox |
| `RATE_LIMIT_WINDOW_MS` | ❌ | Rate limit window (default: 60000) |
| `RATE_LIMIT_MAX` | ❌ | Max requests per window (default: 100) |

## Security Features

- **API Key Authentication**: bcrypt-hashed secret keys, never stored in plaintext
- **HMAC-SHA256 Webhooks**: All outgoing webhooks are signed for merchant verification
- **Rate Limiting**: Per-IP rate limiting to prevent abuse
- **Helmet Security Headers**: Standard HTTP security headers
- **Phone Number Privacy**: Callback data matched by CheckoutRequestID, not phone numbers
- **Single-Use Key Display**: Secret keys shown once during registration/rotation
- **Audit Logging**: All key creation/rotation events logged

## Project Structure

```
payment-gateway/
├── src/
│   ├── config/
│   │   ├── index.ts          # App configuration
│   │   └── redis.ts          # Redis client singleton
│   ├── database/
│   │   └── client.ts         # Prisma client singleton
│   ├── middleware/
│   │   └── auth.ts           # API key authentication
│   ├── services/
│   │   ├── safaricom-oauth.service.ts  # OAuth + Redis caching
│   │   ├── stk-push.service.ts         # STK Push logic
│   │   └── callback.service.ts         # Callback processing
│   ├── controllers/
│   │   ├── charges.controller.ts       # /v1/charges
│   │   ├── callback.controller.ts      # /v1/mpesa-callback
│   │   └── merchant.controller.ts      # /v1/merchants
│   ├── routes/
│   │   └── index.ts          # Route definitions
│   ├── workers/
│   │   └── webhook.worker.ts # BullMQ webhook delivery
│   ├── utils/
│   │   ├── crypto.ts         # Key generation, HMAC, Daraja helpers
│   │   └── phone.ts          # Phone number validation/formatting
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── app.ts                # Express app entry point
├── prisma/
│   └── schema.prisma         # Database schema
├── package.json
├── tsconfig.json
└── README.md
```

## Production Deployment

1. Set `DARAJA_ENV=production` and provide production Daraja credentials
2. Use a managed PostgreSQL (e.g., Supabase, Neon, RDS)
3. Use a managed Redis (e.g., Upstash, ElastiCloud, Redis Cloud)
4. Set all environment variables
5. Run `npx prisma migrate deploy`
6. Build and start: `npm run build && npm start`
