// ═══════════════════════════════════════════════════════════════════════
// M-Pesa Express Gateway — Route Definitions
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { authenticateMerchant, logRequest } from '../middleware/auth.js';
import { chargesController } from '../controllers/charges.controller.js';
import { callbackController } from '../controllers/callback.controller.js';
import { merchantController } from '../controllers/merchant.controller.js';

const router = Router();

// ─── Health Check (no auth) ─────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mpesa-express-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Daraja Callback (no auth — Safaricom calls this) ───────────────
router.post('/v1/mpesa-callback', callbackController.handleDarajaCallback);

// ─── Test Callback (development only) ───────────────────────────────
if (process.env.NODE_ENV === 'development') {
  router.post('/v1/test-callback', callbackController.handleTestCallback);
}

// ─── Merchant Registration (no auth — new merchants sign up) ────────
router.post('/v1/merchants', merchantController.register);

// ─── Authenticated Routes ───────────────────────────────────────────
// All routes below require a valid API key in the Authorization header

router.use('/v1/charges', authenticateMerchant, logRequest);
router.use('/v1/merchants', authenticateMerchant, logRequest);

// ─── Charges (STK Push) ─────────────────────────────────────────────
router.post('/v1/charges', chargesController.createCharge);
router.get('/v1/charges/:checkout_request_id', chargesController.getChargeStatus);

// ─── Merchant Management ────────────────────────────────────────────
router.get('/v1/merchants/me', merchantController.getProfile);
router.get('/v1/merchants/stats', merchantController.getStats);
router.post('/v1/merchants/keys/rotate', merchantController.rotateKeys);

// ─── 404 Handler ────────────────────────────────────────────────────
router.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    timestamp: new Date().toISOString(),
  });
});

export default router;
