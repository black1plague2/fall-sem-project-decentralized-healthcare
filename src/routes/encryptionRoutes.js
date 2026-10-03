const express = require('express');
const multer = require('multer');
const {
  uploadHandler,
  pinAndAnchorHandler,
  wrapKeysHandler,
  accessRequestHandler,
  unlockHandler,
  revokeHandler,
  metadataHandler,
  listRecordsHandler,
  uploadProgressHandler,
  proposeShareHandler,
} = require('../controllers/encryptionController');
const { confirmAnchorHandler } = require('../controllers/anchorController');
const { sensitiveLimiter, authLimiter } = require('../services/rateLimiter');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Standard routes (general rate limiting from app.js)
router.post('/api/encrypt/upload', upload.single('file'), uploadHandler);
router.post('/api/encrypt/pin-and-anchor', pinAndAnchorHandler);
router.post('/api/encrypt/confirm-anchor', confirmAnchorHandler);
router.get('/api/records', listRecordsHandler);
router.get('/api/records/:recordId/metadata', metadataHandler);
router.get('/api/encrypt/progress/:sessionId', uploadProgressHandler);
// Same generic SSE-by-session mechanism, aliased for readability from the
// access-request and revoke flows (all three share one progressService).
router.get('/api/access/progress/:sessionId', uploadProgressHandler);
router.get('/api/revoke/progress/:sessionId', uploadProgressHandler);

// Sensitive routes (strict rate limiting + wallet-based limiting)
router.post('/api/encrypt/wrap-keys', sensitiveLimiter, wrapKeysHandler);
router.post('/api/encrypt/revoke', sensitiveLimiter, revokeHandler);
router.post('/api/encrypt/propose-share', sensitiveLimiter, proposeShareHandler);  // Hydra L2 sharing

// Authentication routes (auth rate limiting)
router.post('/api/access/request', authLimiter, accessRequestHandler);
router.post('/api/encrypt/unlock', sensitiveLimiter, unlockHandler);

module.exports = router;
