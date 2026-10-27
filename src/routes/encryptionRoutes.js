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
  lookupRecordsHandler,
  uploadProgressHandler,
  proposeShareHandler,
} = require('../controllers/encryptionController');
const { confirmAnchorHandler } = require('../controllers/anchorController');
const { sensitiveLimiter, authLimiter } = require('../services/rateLimiter');
const { requireActor } = require('../services/authService');

// Only the record owner (Patient) can create, share or revoke records;
// a requesting actor can only ask for access as themselves.
const patientOnly = requireActor('01');
const asRequestingActor = requireActor((req) => req.body && req.body.actorId);

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Standard routes (general rate limiting from app.js)
router.post('/api/encrypt/upload', patientOnly, upload.single('file'), uploadHandler);
router.post('/api/encrypt/pin-and-anchor', patientOnly, pinAndAnchorHandler);
router.post('/api/encrypt/confirm-anchor', patientOnly, confirmAnchorHandler);
router.get('/api/records', listRecordsHandler);
router.get('/api/records/lookup', lookupRecordsHandler);
router.get('/api/records/:recordId/metadata', patientOnly, metadataHandler);
router.get('/api/encrypt/progress/:sessionId', uploadProgressHandler);
// Same generic SSE-by-session mechanism, aliased for readability from the
// access-request and revoke flows (all three share one progressService).
router.get('/api/access/progress/:sessionId', uploadProgressHandler);
router.get('/api/revoke/progress/:sessionId', uploadProgressHandler);

// Sensitive routes (strict rate limiting + wallet-based limiting)
router.post('/api/encrypt/wrap-keys', patientOnly, sensitiveLimiter, wrapKeysHandler);
router.post('/api/encrypt/revoke', patientOnly, sensitiveLimiter, revokeHandler);
router.post('/api/encrypt/propose-share', patientOnly, sensitiveLimiter, proposeShareHandler);  // Hydra L2 sharing

// Authentication routes (auth rate limiting)
router.post('/api/access/request', asRequestingActor, authLimiter, accessRequestHandler);
router.post('/api/encrypt/unlock', asRequestingActor, sensitiveLimiter, unlockHandler);

module.exports = router;
