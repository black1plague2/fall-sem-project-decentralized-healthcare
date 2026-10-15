const crypto = require('crypto');
const { v4: uuidv4, validate: uuidValidate, version: uuidVersion } = require('uuid');
const Record = require('../models/recordModel');
const cryptoService = require('../services/cryptoService');
const cekManager = require('../services/cekManager');
const ipfsService = require('../services/ipfsService');
const permissionService = require('../services/permissionService');
const walletService = require('../services/walletService');
const { getKMSClient } = require('../services/kmsClient');
const auditLogger = require('../services/auditLogger');
const progressService = require('../services/uploadProgressService');

const ACTOR_IDS = new Set(['01', '02', '03', '04']);
const AUTO_PIN = process.env.PIN_ON_UPLOAD === 'true';

function validateRecordId(id) {
  return typeof id === 'string' && uuidValidate(id) && uuidVersion(id) === 4;
}

/**
 * Verify owner or actor signature.
 * Supports both wallet signatures (production) and HMAC (demo).
 * 
 * @param {string} address - Cardano wallet address
 * @param {string} operation - Operation type (wrapKeys, accessRequest, revoke)
 * @param {string} recordId - Record UUID
 * @param {object|string} signature - Wallet signature object or HMAC string
 * @param {object} additionalData - Operation-specific data to include in payload
 * @returns {Promise<boolean>}
 */
async function verifySignature(address, operation, recordId, signature, additionalData = {}) {
  if (!signature) {
    return false;
  }

  // createSignPayload() stamps its own timestamp unless additionalData
  // supplies one (its ...spread runs last, so it wins). A real CIP-8
  // signature is over the exact bytes the wallet signed client-side —
  // if we let the server mint a fresh Date.now() here instead of reusing
  // the client's, the reconstructed payload would essentially never match
  // what was actually signed and every real wallet signature would fail
  // verification. Callers must pass the client's `timestamp` through
  // additionalData for this to work outside DEMO_MODE.
  const payload = walletService.createSignPayload(operation, recordId, additionalData);

  // Verify using wallet service (handles both wallet and HMAC modes)
  return await walletService.verifySignature(address, payload, signature);
}

async function uploadHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  const startTime = Date.now();
  const sessionId = req.body.sessionId || null;
  const emit = (step, status, data = {}) => {
    if (!sessionId) return;
    progressService.sendUpdate(sessionId, { step, status, ...data });
  };

  try {

    auditLogger.logger.info('📤 Upload request started', {
      requestId,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
      ownerAddr: req.body.ownerAddr
    });
    emit('validate', 'running', { detail: 'Checking file presence and size' });

    if (!req.file || !req.file.buffer) {
      auditLogger.logger.error('❌ Upload failed: No file provided', { requestId });
      emit('validate', 'error', { error: 'No file provided' });
      return res.status(400).json({ error: 'Encrypted package requires a file upload' });
    }
    const ownerAddr = req.body.ownerAddr;
    if (!ownerAddr) {
      auditLogger.logger.error('❌ Upload failed: No owner address', { requestId });
      emit('validate', 'error', { error: 'ownerAddr required' });
      return res.status(422).json({ error: 'ownerAddr is required' });
    }
    emit('validate', 'done', { fileName: req.file.originalname, originalSize: req.file.size });

    auditLogger.logger.info('🔑 Generating 256-bit AES-GCM encryption key...', { requestId });
    emit('generate-cek', 'running', { detail: 'crypto.randomBytes(32) — 256-bit CEK' });
    const cek = await cryptoService.generateCEK();
    emit('generate-cek', 'done', { keyBits: 256 });

    auditLogger.logger.info('🔒 Encrypting file with AES-256-GCM...', {
      requestId,
      originalSize: req.file.buffer.length
    });
    emit('encrypt', 'running', { detail: 'AES-256-GCM authenticated encryption' });
    const { package: encryptedPackage } = cryptoService.encryptAESGCM(req.file.buffer, cek);
    const recordId = uuidv4();
    cekManager.storeTempCEK(recordId, cek);
    emit('encrypt', 'done', { recordId, encryptedSize: encryptedPackage.length });

    const shouldPin = AUTO_PIN || req.body.pinToIpfs === 'true';
    if (shouldPin) {
      auditLogger.logger.info('☁️ Uploading encrypted package to IPFS...', {
        requestId,
        recordId,
        encryptedSize: encryptedPackage.length
      });
      emit('ipfs-pin', 'running', { detail: `Pinning ${encryptedPackage.length} bytes to IPFS` });
      const { cid } = await ipfsService.uploadBufferToIPFS(encryptedPackage);
      const cidHash = cryptoService.sha256hex(cid);
      emit('ipfs-pin', 'done', { cid, cidHash });
      
      // Log successful file upload
      auditLogger.logFileUploaded({
        recordId,
        cid,
        cidHash,
        ownerAddr,
        requestId
      });
      
      // Store in MongoDB
      const actorIds = req.body.actorIds ? req.body.actorIds.split(',').map(id => id.trim()) : ['01'];
      const patientId = req.body.patientId || 'unknown';
      const ownerId = req.body.ownerId || actorIds[0];
      
      // Wrap CEK for each authorized actor
      emit('wrap-keys', 'running', { detail: `RSA-OAEP wrapping CEK for ${actorIds.length} actor(s)` });
      const wrappedKeys = new Map();
      for (const actorId of actorIds) {
        if (ACTOR_IDS.has(actorId)) {
          try {
            const actorPubKey = await cryptoService.loadActorPublicKey(actorId);
            const wrappedKey = cryptoService.wrapKeyRSA(cek, actorPubKey);
            wrappedKeys.set(actorId, wrappedKey.toString('base64'));
            auditLogger.logger.info(`🔐 Wrapped CEK for actor ${actorId}`);
          } catch (err) {
            auditLogger.logger.warn(`⚠️ Could not wrap CEK for actor ${actorId}: ${err.message}`);
          }
        }
      }
      emit('wrap-keys', 'done', { wrappedFor: Array.from(wrappedKeys.keys()) });

      emit('db-save', 'running', { detail: 'Persisting record + wrapped keys to MongoDB' });
      const record = await Record.findOneAndUpdate(
        { recordId },
        {
          $set: {
            owner: ownerAddr,
            cid,
            cidHash,
            status: 'uploaded',
            wrappedKeys: Object.fromEntries(wrappedKeys),
            metadata: {
              patientId,
              originalName: req.file.originalname,
              mimeType: req.file.mimetype,
              size: req.file.size,
              encryptedSize: encryptedPackage.length,
              uploadedAt: new Date()
            }
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      
      emit('db-save', 'done', { recordId, recordStatus: record.status });

      auditLogger.logger.info('✅ Upload complete and saved to database!', {
        recordId,
        cid,
        cidHash: cidHash.substring(0, 16) + '...',
        encryptedSize: encryptedPackage.length,
        actors: actorIds
      });

      // 🚀 AUTO-SHARE VIA HYDRA: Automatically propose sharing to Hydra Layer-2
      // This makes permission checks 100-400x faster (5-15ms vs 500-2000ms)
      const AUTO_SHARE_HYDRA = process.env.AUTO_SHARE_HYDRA !== 'false';

      if (AUTO_SHARE_HYDRA) {
        try {
          emit('hydra-share', 'running', { detail: 'Proposing state update to Hydra L2 head' });
          const { getHydraClient, getOrCreateDefaultHead } = require('../services/hydraClient');
          const hydraHeadId = await getOrCreateDefaultHead();
          const hydraClient = getHydraClient();

          auditLogger.logger.info('🔄 Auto-sharing to Hydra Layer-2...', {
            recordId,
            headId: hydraHeadId,
            actors: actorIds
          });

          // Prepare wrapped keys for Hydra snapshot
          const wrappedKeysArray = actorIds.map(actorId => ({
            actorId,
            wrappedKey: wrappedKeys.get(actorId) || 'mock-wrapped-key',
            ephemeralPublicKey: 'mock-ephemeral-pub-key'
          }));

          // Propose update to Hydra
          const hydraResponse = await hydraClient.proposeUpdate(hydraHeadId, {
            type: 'SHARE_RECORD',
            recordId,
            cidHash,
            wrappedKeys: wrappedKeysArray,
            author: ownerAddr,
            timestamp: Date.now()
          });
          
          // Persist snapshot to MongoDB
          const HydraSnapshot = require('../models/hydraSnapshotModel');
          
          // Build complete snapshot data structure
          const snapshotData = {
            epoch: hydraResponse.epoch,
            snapshotId: hydraResponse.snapshotId,
            status: hydraResponse.status,
            acceptedAt: new Date().toISOString(),
            records: {
              [recordId]: {
                cidHash,
                permittedActors: actorIds,
                wrappedKeys: wrappedKeysArray,
                author: ownerAddr,
                lastUpdated: new Date().toISOString()
              }
            }
          };
          
          const snapshot = new HydraSnapshot({
            headId: hydraHeadId,
            snapshotId: hydraResponse.snapshotId,
            epoch: hydraResponse.epoch,
            snapshot: snapshotData,  // ✅ Required field!
            status: hydraResponse.status || 'accepted',
            records: [{
              recordId,
              cidHash,
              permittedActors: actorIds,
              wrappedKeys: wrappedKeysArray,
              author: ownerAddr,
              lastUpdated: new Date()
            }],
            acceptedAt: new Date()
          });
          await snapshot.save();

          auditLogger.logger.info('✅ Auto-shared to Hydra!', {
            recordId,
            snapshotId: hydraResponse.snapshotId,
            actors: actorIds
          });
          emit('hydra-share', 'done', { detail: `Snapshot epoch ${hydraResponse.epoch} accepted by the head`, headId: hydraHeadId, snapshotId: hydraResponse.snapshotId, epoch: hydraResponse.epoch });
        } catch (hydraError) {
          // Non-blocking: Log error but don't fail upload
          auditLogger.logger.warn('⚠️ Hydra auto-share failed (non-blocking)', {
            recordId,
            error: hydraError.message
          });
          emit('hydra-share', 'error', { error: hydraError.message });
        }
      }

      emit('complete', 'done', { recordId, cid, cidHash });
      if (sessionId) progressService.closeSession(sessionId);

      return res.status(200).json({
        recordId,
        cid,
        cidHash,
        encryptedSize: encryptedPackage.length,
        originalSize: req.file.size,
        fileName: req.file.originalname,
        actors: actorIds,
        hydraShared: AUTO_SHARE_HYDRA
      });
    }
    emit('complete', 'done', { recordId });
    if (sessionId) progressService.closeSession(sessionId);
    return res.status(200).json({ recordId, encryptedPackageBase64: encryptedPackage.toString('base64') });
  } catch (error) {
    auditLogger.logger.error('❌ Upload failed with error:', { error: error.message, stack: error.stack });
    if (sessionId) progressService.sendUpdate(sessionId, { step: 'error', status: 'error', error: error.message });
    return next(error);
  }
}

async function pinAndAnchorHandler(req, res, next) {
  try {
    const { recordId, encryptedPackageBase64, cid: providedCid, ownerAddr } = req.body;
    if (!validateRecordId(recordId)) {
      return res.status(422).json({ error: 'recordId must be a UUID v4' });
    }
    let cid = providedCid;
    if (!cid) {
      if (!encryptedPackageBase64) {
        return res.status(400).json({ error: 'Provide encryptedPackageBase64 or cid' });
      }
      const pkgBuffer = Buffer.from(encryptedPackageBase64, 'base64');
      const upload = await ipfsService.uploadBufferToIPFS(pkgBuffer);
      cid = upload.cid;
    }
    const cidHash = cryptoService.sha256hex(cid);
    const record = await Record.findOneAndUpdate(
      { recordId },
      {
        $set: {
          owner: ownerAddr || 'unknown',
          cid,
          cidHash,
          status: 'pending_anchor',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const anchorPayload = {
      recordId,
      cid,
      cidHash,
      network: process.env.CARDANO_NETWORK || 'testnet',
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json({ record: record.toSafeJSON(), anchorPayload });
  } catch (error) {
    return next(error);
  }
}

async function wrapKeysHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  const startTime = Date.now();
  
  try {
    const { recordId, ownerAddr, ownerSignature, actorPublicKeys = {}, timestamp } = req.body;
    
    auditLogger.logger.info('🔐 Wrap keys request received', {
      requestId,
      recordId,
      actorCount: Object.keys(actorPublicKeys).length,
      actorIds: Object.keys(actorPublicKeys).join(', ')
    });
    
    if (!validateRecordId(recordId)) {
      return res.status(422).json({ error: 'Invalid recordId' });
    }
    
    // Get record to verify owner
    const record = await Record.findOne({ recordId });
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    // Use owner address from record or request
    const address = ownerAddr || record.owner;
    if (!address) {
      return res.status(422).json({ error: 'Owner address required' });
    }
    
    // Verify wallet signature
    const isValidSignature = await verifySignature(
      address, 
      'wrapKeys', 
      recordId, 
      ownerSignature,
      { actorIds: Object.keys(actorPublicKeys), timestamp }
    );
    
    if (!isValidSignature) {
      auditLogger.logSignatureVerificationFailed({
        operation: 'wrapKeys',
        walletAddr: address,
        requestId,
        reason: 'Invalid signature'
      });
      return res.status(401).json({ error: 'Owner signature invalid' });
    }
    
    const cek = cekManager.getTempCEK(recordId);
    if (!cek) {
      return res.status(400).json({ error: 'CEK not found or already wrapped' });
    }
    const wrappedEntries = {};
    for (const [actorId, publicKeyPem] of Object.entries(actorPublicKeys)) {
      if (!ACTOR_IDS.has(actorId)) {
        continue;
      }
      try {
        const wrapped = cryptoService.wrapKeyRSA(cek, publicKeyPem);
        wrappedEntries[actorId] = wrapped.toString('base64');
        
        // Log each successful wrap
        auditLogger.logCEKWrapped({
          recordId,
          actorId,
          requestId
        });
      } catch (err) {
        auditLogger.logger.error('❌ Key wrapping failed', {
          requestId,
          recordId,
          actorId,
          error: err.message
        });
        return res.status(422).json({ error: `Failed to wrap key for actor ${actorId}: ${err.message}` });
      }
    }
    if (Object.keys(wrappedEntries).length === 0) {
      return res.status(422).json({ error: 'Provide at least one valid actor public key' });
    }
    Object.entries(wrappedEntries).forEach(([actorId, wrappedKey]) => {
      record.wrappedKeys.set(actorId, wrappedKey);
    });
    await record.save();
    cekManager.deleteTempCEK(recordId);
    
    // Store permission on Midnight (privacy-preserving ZK layer)
    try {
      const { storePermissionOnMidnight, getMidnightStats } = require('../services/midnightService');
      const midnightStats = getMidnightStats();
      
      if (midnightStats.enabled) {
        console.log('[wrapKeys] Storing permission on Midnight ZK layer...');
        const actorIds = Object.keys(wrappedEntries);
        const midnightResult = await storePermissionOnMidnight(recordId, actorIds, {
          timestamp: Date.now(),
          recordMetadata: {
            patientId: record.metadata?.patientId,
            fileType: record.metadata?.mimeType
          }
        });
        
        console.log(`[wrapKeys] ✅ Midnight permission stored | Commitment: ${midnightResult.commitment.substring(0, 16)}...`);
        
        auditLogger.logger.info('midnight_permission_stored', {
          recordId,
          actorCount: actorIds.length,
          commitment: midnightResult.commitment,
          txId: midnightResult.txId
        });
      }
    } catch (midnightError) {
      // Non-fatal: Midnight storage is optional privacy layer
      console.warn('[wrapKeys] Failed to store on Midnight (non-fatal):', midnightError.message);
    }
    
    return res.status(200).json({ record: record.toSafeJSON() });
  } catch (error) {
    return next(error);
  }
}

async function accessRequestHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  const startTime = Date.now();
  const sessionId = req.body.sessionId || null;
  const emit = (step, status, data = {}) => {
    if (!sessionId) return;
    progressService.sendUpdate(sessionId, { step, status, ...data });
  };

  try {
    const { recordId, actorId, actorAddr, actorSignature, timestamp } = req.body;

    auditLogger.logger.info('🔍 Access request received', {
      requestId,
      recordId,
      actorId,
      actorAddr: actorAddr ? actorAddr.substring(0, 20) + '...' : 'undefined'
    });
    
    if (!validateRecordId(recordId)) {
      return res.status(422).json({ error: 'Invalid recordId' });
    }
    if (!ACTOR_IDS.has(actorId)) {
      return res.status(422).json({ error: 'actorId must be one of 01..04' });
    }
    if (!actorSignature) {
      return res.status(401).json({ error: 'actorSignature required' });
    }
    
    // Get actor address (from request or demo mapping)
    const address = actorAddr || walletService.getActorAddress(actorId);
    if (!address) {
      return res.status(422).json({ error: 'Actor address required' });
    }
    
    // Verify actor signature
    const isValidSignature = await verifySignature(
      address,
      'accessRequest',
      recordId,
      actorSignature,
      { actorId, timestamp }
    );

    if (!isValidSignature) {
      auditLogger.logSignatureVerificationFailed({
        operation: 'accessRequest',
        walletAddr: address,
        requestId,
        reason: 'Invalid signature'
      });
      return res.status(401).json({ error: 'Actor signature invalid' });
    }
    
    const record = await Record.findOne({ recordId });
    if (!record || !record.cid) {
      return res.status(404).json({ error: 'Record not found or not pinned yet' });
    }
    // The cascade runs first so the live view shows which layer refused an
    // actor that was never granted (or was revoked). Release still needs
    // BOTH a cascade grant and a current wrapped key, checked right after.
    const permissionResult = await permissionService.verifyPermission(recordId, actorId, {
      requestId,
      record,
      onStep: (layer, status, detail) => emit(`layer:${layer}`, status, detail),
    });
    if (!permissionResult.granted) {
      auditLogger.logAccessDenied({
        recordId,
        actorId,
        actorAddr: address,
        reason: permissionResult.reason || 'Permission denied',
        requestId
      });
      emit('complete', 'denied', { source: permissionResult.source, reason: permissionResult.reason });
      if (sessionId) progressService.closeSession(sessionId);
      const LAYER_NAMES = { hydra: 'the Hydra L2 snapshot', aiken: 'the Aiken validator', 'midnight-zk': 'the Midnight ZK proof', blockfrost: 'Blockfrost L1', 'local-db-demo': 'the local access list' };
      return res.status(403).json({
        error: `Refused by ${LAYER_NAMES[permissionResult.source] || 'the permission cascade'}: this actor is not on the record's access list`,
        verificationMethod: permissionResult.source,
      });
    }

    const wrappedKeyBase64 = record.wrappedKeys.get(actorId);
    if (!wrappedKeyBase64) {
      auditLogger.logAccessDenied({
        recordId,
        actorId,
        actorAddr: address,
        reason: 'No wrapped key found for actor',
        requestId
      });
      emit('complete', 'denied', { source: 'wrapped-key-check', reason: 'no current wrapped key' });
      if (sessionId) progressService.closeSession(sessionId);
      return res.status(403).json({ error: 'Actor does not hold a current wrapped key for this record' });
    }

    // Log successful access grant
    const duration = Date.now() - startTime;
    auditLogger.logAccessGranted({
      recordId,
      actorId,
      actorAddr: address,
      requestId
    });

    auditLogger.logger.info('✅ Access granted', {
      requestId,
      recordId,
      actorId,
      verificationMethod: permissionResult.source || 'unknown',
      duration: `${duration}ms`,
      cid: record.cid
    });

    emit('complete', 'granted', { source: permissionResult.source, verificationTime: duration });
    if (sessionId) progressService.closeSession(sessionId);

    return res.status(200).json({
      recordId,
      cid: record.cid,
      wrappedKeyBase64,
      verificationMethod: permissionResult.source,
      verificationTime: duration,
      note: 'Client must unwrap CEK locally and decrypt IPFS content over TLS',
    });
  } catch (error) {
    auditLogger.logger.error('❌ Access request failed', {
      requestId,
      error: error.message,
      stack: error.stack
    });
    if (sessionId) progressService.sendUpdate(sessionId, { step: 'error', status: 'error', error: error.message });
    if (error.message.includes('Blockfrost')) {
      return res.status(503).json({ error: 'Permission service unavailable' });
    }
    return next(error);
  }
}

/**
 * POST /api/encrypt/unlock
 * Actually unwraps the CEK and decrypts the file for an authorized actor,
 * returning the real plaintext as a download. This is the payoff step
 * after /api/access/request: that endpoint only hands back the wrapped
 * key (as a real wallet-based client would unwrap it itself); this one
 * performs the unwrap+decrypt server-side for the browser demo, using the
 * actor's private key from scripts/keys/ (demo-only — see cryptoService
 * notes; production should unwrap client-side or via a hardware wallet).
 */
async function unlockHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  try {
    const { recordId, actorId, actorAddr, actorSignature, timestamp } = req.body;

    auditLogger.logger.info('🔓 Unlock request received', { requestId, recordId, actorId });

    if (!validateRecordId(recordId)) {
      return res.status(422).json({ error: 'Invalid recordId' });
    }
    if (!ACTOR_IDS.has(actorId)) {
      return res.status(422).json({ error: 'actorId must be one of 01..04' });
    }
    if (!actorSignature) {
      return res.status(401).json({ error: 'actorSignature required' });
    }

    const address = actorAddr || walletService.getActorAddress(actorId);
    if (!address) {
      return res.status(422).json({ error: 'Actor address required' });
    }

    const isValidSignature = await verifySignature(address, 'unlock', recordId, actorSignature, { actorId, timestamp });
    if (!isValidSignature) {
      auditLogger.logSignatureVerificationFailed({ operation: 'unlock', walletAddr: address, requestId, reason: 'Invalid signature' });
      return res.status(401).json({ error: 'Actor signature invalid' });
    }

    const record = await Record.findOne({ recordId });
    if (!record || !record.cid) {
      return res.status(404).json({ error: 'Record not found or not pinned yet' });
    }

    const wrappedKeyBase64 = record.wrappedKeys.get(actorId);
    if (!wrappedKeyBase64) {
      auditLogger.logAccessDenied({ recordId, actorId, actorAddr: address, reason: 'No wrapped key found for actor', requestId });
      return res.status(404).json({ error: 'Actor does not have a wrapped CEK' });
    }

    // Re-verify the same 4-layer cascade used by /api/access/request — an
    // actor can't unlock a file just by having once had a wrapped key.
    const permissionResult = await permissionService.verifyPermission(recordId, actorId, { requestId });
    if (!permissionResult.granted) {
      auditLogger.logAccessDenied({ recordId, actorId, actorAddr: address, reason: permissionResult.reason || 'Permission denied', requestId });
      return res.status(403).json({ error: 'Permission denied by on-chain policy or Midnight proof' });
    }

    const actorLabel = ACTOR_LABELS[parseInt(actorId, 10) - 1];

    let cek;
    try {
      const privateKeyPem = await cryptoService.readActorKeyFile(`actor-${actorId}-${actorLabel}-priv.pem`);
      const wrappedKeyBuffer = Buffer.from(wrappedKeyBase64, 'base64');
      cek = cryptoService.unwrapKeyRSA(wrappedKeyBuffer, privateKeyPem);
    } catch (keyErr) {
      auditLogger.logger.error('❌ Unlock failed: could not unwrap CEK', { requestId, recordId, actorId, error: keyErr.message });
      return res.status(500).json({ error: 'Failed to unwrap key for this actor', message: keyErr.message });
    }

    const encryptedPackage = await ipfsService.downloadFromIPFS(record.cid);
    const plaintext = cryptoService.decryptAESGCM(encryptedPackage, cek);
    cek.fill(0);

    auditLogger.logAccessGranted({ recordId, actorId, actorAddr: address, requestId });
    auditLogger.logger.info('✅ File unlocked and decrypted', {
      requestId, recordId, actorId, verificationMethod: permissionResult.source, plaintextBytes: plaintext.length,
    });

    const filename = ((record.metadata && record.metadata.originalName) || 'record').replace(/["\r\n]/g, '');
    const mimeType = (record.metadata && record.metadata.mimeType) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Verification-Method', permissionResult.source);
    return res.status(200).send(plaintext);
  } catch (error) {
    auditLogger.logger.error('❌ Unlock failed', { requestId, error: error.message, stack: error.stack });
    return next(error);
  }
}

async function revokeHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  const startTime = Date.now();
  const sessionId = req.body.sessionId || null;
  const emit = (step, status, data = {}) => {
    if (!sessionId) return;
    progressService.sendUpdate(sessionId, { step, status, ...data });
  };

  try {
    const { recordId, actorId, ownerAddr, ownerSignature, timestamp } = req.body;

    auditLogger.logger.info('🚫 Revoke request received', {
      requestId,
      recordId,
      actorId,
      ownerAddr: ownerAddr ? ownerAddr.substring(0, 20) + '...' : 'undefined'
    });
    
    if (!validateRecordId(recordId) || !ACTOR_IDS.has(actorId)) {
      return res.status(422).json({ error: 'Invalid recordId or actorId' });
    }
    
    const record = await Record.findOne({ recordId });
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    const oldCID = record.cid;
    
    // Use owner address from record or request
    const address = ownerAddr || record.owner;
    if (!address) {
      return res.status(422).json({ error: 'Owner address required' });
    }
    
    // Verify owner signature
    const isValidSignature = await verifySignature(
      address,
      'revoke',
      recordId,
      ownerSignature,
      { actorId, timestamp }
    );

    if (!isValidSignature) {
      auditLogger.logSignatureVerificationFailed({
        operation: 'revoke',
        walletAddr: address,
        requestId,
        reason: 'Invalid signature'
      });
      return res.status(401).json({ error: 'Owner signature invalid' });
    }
    
    emit('revoke-actor', 'running', { actorId, detail: 'Removing actor from wrapped-key map' });
    record.wrappedKeys.delete(actorId);
    if (record.wrappedKeys.size === 0) {
      record.status = 'revoked';
      await record.save();

      auditLogger.logRevocation({
        recordId,
        actorId,
        ownerAddr: address,
        rotationStatus: 'skipped',
        requestId
      });

      emit('revoke-actor', 'done', { actorId, remainingActors: 0 });
      emit('complete', 'done', { rotationStatus: 'skipped' });
      if (sessionId) progressService.closeSession(sessionId);

      return res.status(200).json({
        record: record.toSafeJSON(),
        message: `Actor ${actorId} revoked. No actors remaining - rotation skipped.`
      });
    }

    await record.save();
    emit('revoke-actor', 'done', { actorId, remainingActors: record.wrappedKeys.size });

    // Attempt CEK rotation
    let rotationStatus = 'pending';
    let rotationError = null;
    let newCID = null;

    try {
      const rotationResult = await rotateCEK(record, (step, status, detail) => emit(`rotate:${step}`, status, detail));
      rotationStatus = 'completed';
      newCID = rotationResult?.newCID || record.cid;
      
      auditLogger.logger.info('🔄 CEK rotation successful', {
        requestId,
        recordId,
        oldCID,
        newCID,
        duration: `${Date.now() - startTime}ms`
      });
    } catch (rotationErr) {
      rotationStatus = 'failed';
      rotationError = rotationErr.message;
      
      auditLogger.logger.error('❌ CEK rotation failed', {
        requestId,
        recordId,
        error: rotationErr.message
      });
      
      console.error(`[Revoke] CEK rotation failed but revocation recorded: ${rotationErr.message}`);
      // Revocation still succeeds even if rotation fails (security: actor removed from DB)
    }
    
    // Publish the shrunken access list to Hydra L2 so the fast path agrees
    // with the record. Non-blocking: the revoked actor's wrapped key is
    // already gone, so access fails closed even if this step fails.
    try {
      emit('hydra-sync', 'running', { detail: 'Publishing revocation to Hydra L2 head' });
      const { publishRecordToHydra } = require('../services/hydraClient');
      const hydra = await publishRecordToHydra({
        type: 'REVOKE_ACTOR',
        recordId,
        cidHash: record.cid,
        actorIds: Array.from(record.wrappedKeys.keys()),
        author: address,
      });
      emit('hydra-sync', 'done', { detail: `Snapshot epoch ${hydra.epoch} signed by all parties`, snapshotId: hydra.snapshotId, epoch: hydra.epoch });
    } catch (hydraErr) {
      auditLogger.logger.warn('Hydra revoke sync failed (non-blocking)', { recordId, error: hydraErr.message });
      emit('hydra-sync', 'error', { error: hydraErr.message });
    }

    // Log revocation
    auditLogger.logRevocation({
      recordId,
      actorId,
      ownerAddr: address,
      rotationStatus,
      requestId
    });
    
    const duration = Date.now() - startTime;
    auditLogger.logger.info('✅ Revocation complete', {
      requestId,
      recordId,
      actorId,
      rotationStatus,
      duration: `${duration}ms`
    });

    emit('complete', 'done', { rotationStatus, oldCID, newCID });
    if (sessionId) progressService.closeSession(sessionId);

    return res.status(200).json({
      record: record.toSafeJSON(),
      message: `Actor ${actorId} revoked`,
      rotation: {
        status: rotationStatus,
        oldCID,
        newCID,
        error: rotationError,
        note: rotationStatus === 'failed'
          ? 'Actor removed from access list, but CEK rotation failed. Manual intervention may be required.'
          : 'CEK rotated successfully. Revoked actor cannot decrypt future uploads.'
      }
    });
  } catch (error) {
    auditLogger.logger.error('❌ Revoke failed', {
      requestId,
      error: error.message,
      stack: error.stack
    });
    if (sessionId) progressService.sendUpdate(sessionId, { step: 'error', status: 'error', error: error.message });
    return next(error);
  }
}

async function metadataHandler(req, res, next) {
  try {
    const { recordId } = req.params;
    if (!validateRecordId(recordId)) {
      return res.status(422).json({ error: 'Invalid recordId' });
    }
    const record = await Record.findOne({ recordId });
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    return res.status(200).json(record.toSafeJSON());
  } catch (error) {
    return next(error);
  }
}

/**
 * Rotate CEK after actor revocation to maintain zero-trust security.
 * 
 * Process:
 * 1. Download encrypted package from IPFS
 * 2. Unwrap old CEK using owner's wrapped key
 * 3. Decrypt package with old CEK
 * 4. Generate new CEK
 * 5. Re-encrypt with new CEK
 * 6. Upload new package to IPFS
 * 7. Update record with new CID
 * 8. Re-wrap new CEK for remaining actors
 * 9. Update on-chain anchor (in production)
 * 
 * @param {Object} record - Mongoose record document
 * @param {function} [onStep] - Optional callback(stepName, status, detail) for live UI visualization
 * @returns {Promise<Object>} Updated record with new CID and wrapped keys
 */
const ACTOR_LABELS = ['patient', 'doctor', 'hospital', 'insurance'];

async function rotateCEK(record, onStep = () => {}) {
  console.info(`[CEK Rotation] Starting rotation for record ${record.recordId}`);

  try {
    // Safety check: need at least one actor to re-wrap for
    if (record.wrappedKeys.size === 0) {
      console.warn(`[CEK Rotation] No actors remaining for ${record.recordId} - skipping rotation`);
      return record;
    }

    // Check if we have the old CID
    if (!record.cid) {
      throw new Error('Record has no CID - cannot download for rotation');
    }

    console.info(`[CEK Rotation] Step 1/9: Downloading encrypted package from IPFS (CID: ${record.cid})`);
    onStep('download', 'running', { cid: record.cid });
    const encryptedPackage = await ipfsService.downloadFromIPFS(record.cid);
    onStep('download', 'done', { bytes: encryptedPackage.length });

    // For demo purposes, we need an owner's wrapped key to unwrap the old CEK
    // In production, this would use HSM/KMS or secure owner key management
    // For now, we'll use the first available wrapped key (representing owner access)
    const firstActorId = Array.from(record.wrappedKeys.keys())[0];
    const firstWrappedKey = record.wrappedKeys.get(firstActorId);

    if (!firstWrappedKey) {
      throw new Error('No wrapped keys available to unwrap old CEK');
    }

    console.info(`[CEK Rotation] Step 2/9: Unwrapping old CEK`);
    onStep('unwrap-old-cek', 'running', { actorId: firstActorId });

    let oldCEK;
    // A DEMO_MODE deployment (like the hosted demo) uses the demo actor keys
    // even when NODE_ENV is production; real deployments still require KMS.
    const isProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
    const kmsProvider = process.env.KMS_PROVIDER || 'mock';
    
    if (isProduction && kmsProvider === 'mock') {
      throw new Error(
        'PRODUCTION ERROR: CEK rotation requires KMS integration. ' +
        'Set KMS_PROVIDER to aws/vault/azure and configure credentials. ' +
        'See docs/DEPLOYMENT.md for KMS setup instructions.'
      );
    }

    try {
      // Use KMS to decrypt the wrapped CEK
      const kmsClient = getKMSClient();
      const keyRef = await kmsClient.getPrivateKeyRef(record.owner || firstActorId);
      
      auditLogger.logger.info('[CEK Rotation] Using KMS to unwrap CEK', {
        recordId: record.recordId,
        kmsProvider,
        keyRef: keyRef.substring(0, 20) + '...'
      });
      
      oldCEK = await kmsClient.decryptWithKMS(keyRef, firstWrappedKey);
      
      auditLogger.logger.info('[CEK Rotation] Successfully unwrapped CEK via KMS', {
        recordId: record.recordId,
        cekSize: oldCEK.length
      });
    } catch (kmsErr) {
      // Fallback to filesystem keys ONLY in development mode
      if (!isProduction) {
        console.warn(`[CEK Rotation] KMS unwrap failed, falling back to filesystem keys (dev mode only)`);
        console.warn(`[CEK Rotation] KMS Error: ${kmsErr.message}`);
        
        const firstActorLabel = ACTOR_LABELS[parseInt(firstActorId, 10) - 1];

        try {
          const privateKeyPem = await cryptoService.readActorKeyFile(`actor-${firstActorId}-${firstActorLabel}-priv.pem`);
          const wrappedKeyBuffer = Buffer.from(firstWrappedKey, 'base64');
          oldCEK = cryptoService.unwrapKeyRSA(wrappedKeyBuffer, privateKeyPem);
          
          auditLogger.logger.warn('[CEK Rotation] Used filesystem fallback (DEV ONLY)', {
            recordId: record.recordId,
            reason: kmsErr.message
          });
        } catch (fsErr) {
          throw new Error(`Failed to unwrap old CEK: ${fsErr.message}`);
        }
      } else {
        throw new Error(`KMS unwrap failed in production: ${kmsErr.message}`);
      }
    }

    onStep('unwrap-old-cek', 'done', {});

    console.info(`[CEK Rotation] Step 3/9: Decrypting package with old CEK`);
    onStep('decrypt-old', 'running', {});
    const plaintext = cryptoService.decryptAESGCM(encryptedPackage, oldCEK);
    onStep('decrypt-old', 'done', { plaintextBytes: plaintext.length });

    console.info(`[CEK Rotation] Step 4/9: Generating new CEK`);
    onStep('generate-new-cek', 'running', {});
    const newCEK = await cryptoService.generateCEK();
    onStep('generate-new-cek', 'done', { keyBits: 256 });

    console.info(`[CEK Rotation] Step 5/9: Re-encrypting with new CEK`);
    onStep('re-encrypt', 'running', {});
    const { package: newEncryptedPackage } = cryptoService.encryptAESGCM(plaintext, newCEK);
    onStep('re-encrypt', 'done', { encryptedSize: newEncryptedPackage.length });

    console.info(`[CEK Rotation] Step 6/9: Uploading new package to IPFS`);
    onStep('ipfs-reupload', 'running', {});
    const { cid: newCID } = await ipfsService.uploadBufferToIPFS(newEncryptedPackage);
    onStep('ipfs-reupload', 'done', { newCid: newCID });

    console.info(`[CEK Rotation] Step 7/9: Updating record with new CID (${newCID})`);
    onStep('update-record', 'running', {});
    record.cid = newCID;
    record.cidHash = cryptoService.sha256hex(newCID);
    onStep('update-record', 'done', { newCid: newCID, newCidHash: record.cidHash });

    console.info(`[CEK Rotation] Step 8/9: Re-wrapping new CEK for ${record.wrappedKeys.size} remaining actors`);
    onStep('re-wrap-keys', 'running', { remainingActors: record.wrappedKeys.size });

    // Load actor public keys and re-wrap
    const actorIds = Array.from(record.wrappedKeys.keys());
    const newWrappedKeys = new Map();

    for (const actorId of actorIds) {
      try {
        // In production, actors should use their own KMS keys or client-side wrapping
        // For development/demo, use filesystem keys

        if (!isProduction) {
          const actorLabel = ACTOR_LABELS[parseInt(actorId, 10) - 1];
          const publicKeyPem = await cryptoService.readActorKeyFile(`actor-${actorId}-${actorLabel}-pub.pem`);

          const wrapped = cryptoService.wrapKeyRSA(newCEK, publicKeyPem);
          newWrappedKeys.set(actorId, wrapped.toString('base64'));

          console.info(`[CEK Rotation]   - Re-wrapped for actor ${actorId} (filesystem key)`);
        } else {
          // In production, store a placeholder indicating client-side wrap required
          // The actor will need to call /api/encrypt/wrap-keys with their public key
          console.info(`[CEK Rotation]   - Actor ${actorId} requires client-side re-wrap`);
          // For now, skip production re-wrap (manual intervention required)
          auditLogger.logger.warn('[CEK Rotation] Production re-wrap not automated', {
            recordId: record.recordId,
            actorId,
            note: 'Actor must call wrap-keys endpoint with new CEK'
          });
        }
      } catch (err) {
        console.error(`[CEK Rotation] Failed to re-wrap for actor ${actorId}: ${err.message}`);
        auditLogger.logger.error('[CEK Rotation] Re-wrap failed', {
          recordId: record.recordId,
          actorId,
          error: err.message
        });
        // Continue with other actors
      }
    }
    
    // Update record with new wrapped keys
    record.wrappedKeys = newWrappedKeys;
    onStep('re-wrap-keys', 'done', { reWrappedCount: newWrappedKeys.size });

    console.info(`[CEK Rotation] Step 9/9: Updating on-chain anchor`);
    onStep('anchor-update', 'running', {});
    // The anchor tx must be signed by the owner's wallet, so the server can't
    // submit it. If the record was anchored, the old anchor now points at a
    // stale CID: drop back to pending_anchor and hand out the new payload,
    // which the owner submits and confirms via POST /api/encrypt/confirm-anchor
    // (same path as the initial upload).
    const anchorPayload = {
      recordId: record.recordId,
      cid: record.cid,
      cidHash: record.cidHash,
      network: process.env.CARDANO_NETWORK || 'testnet',
      timestamp: new Date().toISOString(),
    };
    const needsReanchor = record.status === 'anchored';
    if (needsReanchor) {
      record.status = 'pending_anchor';
      record.onchainTx = undefined;
    }

    // Save the updated record
    await record.save();
    onStep('anchor-update', 'done', needsReanchor
      ? { anchorPayload, note: 'owner must submit a new anchor tx and call confirm-anchor' }
      : { anchorPayload, note: 'record was not anchored on-chain; nothing to update' });

    // Zero out sensitive data from memory
    if (oldCEK) oldCEK.fill(0);
    if (newCEK) newCEK.fill(0);
    if (plaintext) plaintext.fill(0);

    auditLogger.logger.info('[CEK Rotation] Rotation complete', {
      recordId: record.recordId,
      oldCID: record.cid,
      newCID: newCID,
      actorsWithAccess: actorIds.join(', '),
      reWrappedCount: newWrappedKeys.size
    });
    
    console.info(`[CEK Rotation] ✅ Rotation complete for ${record.recordId}`);
    console.info(`[CEK Rotation]   - Old CID: ${encryptedPackage ? 'downloaded' : 'N/A'}`);
    console.info(`[CEK Rotation]   - New CID: ${newCID}`);
    console.info(`[CEK Rotation]   - Actors with access: ${actorIds.join(', ')}`);
    
    return record;
  } catch (error) {
    auditLogger.logger.error('[CEK Rotation] Rotation failed', {
      recordId: record.recordId,
      error: error.message,
      stack: error.stack
    });
    
    console.error(`[CEK Rotation] ❌ Rotation failed for ${record.recordId}: ${error.message}`);
    
    // In production, this should trigger alerts and rollback mechanisms
    throw new Error(`CEK rotation failed: ${error.message}`);
  }
}

/**
 * GET /api/records - List all records with optional filtering
 */
async function listRecordsHandler(req, res, next) {
  try {
    const { patientId, owner, status, limit = 50, skip = 0 } = req.query;
    
    auditLogger.logger.info('📋 List records request', {
      patientId,
      owner,
      status,
      limit: parseInt(limit),
      skip: parseInt(skip)
    });

    // Build query
    const query = {};
    if (patientId) {
      query['metadata.patientId'] = patientId;
    }
    if (owner) {
      query.owner = owner;
    }
    if (status) {
      query.status = status;
    }

    // Fetch records
    const records = await Record.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Record.countDocuments(query);

    // Transform to safe format
    const safeRecords = records.map(r => ({
      recordId: r.recordId,
      owner: r.owner,
      cid: r.cid,
      cidHash: r.cidHash,
      onchainTx: r.onchainTx,
      status: r.status,
      createdAt: r.createdAt,
      metadata: r.metadata || {},
      wrappedActors: r.wrappedKeys ? Array.from(Object.keys(r.wrappedKeys)) : []
    }));

    auditLogger.logger.info('✅ List records complete', {
      total,
      returned: safeRecords.length
    });

    res.json({
      success: true,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip),
      records: safeRecords
    });
  } catch (error) {
    auditLogger.logger.error('❌ List records failed', {
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
}

/**
 * SSE endpoint for live pipeline progress (upload / access / revoke all
 * share this — see uploadProgressService.js). Backed by MongoDB rather
 * than in-process memory so it's correct on serverless deployments where
 * the triggering POST and this GET may run on different instances.
 * GET /api/encrypt/progress/:sessionId
 */
function uploadProgressHandler(req, res) {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders && res.flushHeaders();

  progressService.streamSession(sessionId, res);
}

/**
 * POST /api/encrypt/propose-share
 * Propose record sharing via Hydra Layer-2 (off-chain fast path)
 * 
 * Flow:
 * 1. Load record from database
 * 2. Verify the owner's wallet signature (CIP-8)
 * 3. Compute wrappedKeys for new actors using X25519
 * 4. Propose update to Hydra head
 * 5. Persist accepted snapshot to MongoDB
 * 6. Respond with snapshot info
 * 
 * Body: {
 *   payload: { operation, recordId, cidHash, actors: [], timestamp },
 *   signature: { key, signature },
 *   headId: string
 * }
 * 
 * Rate limited by sensitiveLimiter (see encryptionRoutes.js).
 * Note: wrapping happens server-side; moving it client-side would keep the
 * CEK off the server entirely.
 */
async function proposeShareHandler(req, res) {
  try {
    const { payload, signature, headId } = req.body;
    
    // Validate required fields
    if (!payload || !signature || !headId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['payload', 'signature', 'headId']
      });
    }
    
    if (!payload.recordId || !payload.actors || !Array.isArray(payload.actors)) {
      return res.status(400).json({
        error: 'Invalid payload',
        required: 'payload must contain recordId and actors array'
      });
    }
    
    auditLogger.logger.info('[ProposeShare] Request received', {
      recordId: payload.recordId,
      actors: payload.actors,
      headId
    });
    
    // Step 1: Load record from database (needed first: only the record's
    // owner may share it, so the signature is checked against record.owner)
    const record = await Record.findOne({ recordId: payload.recordId });

    if (!record) {
      return res.status(404).json({
        error: 'Record not found',
        recordId: payload.recordId
      });
    }

    auditLogger.logger.info('[ProposeShare] Record loaded', {
      recordId: record.recordId,
      owner: record.owner,
      currentActors: record.wrappedKeys ? record.wrappedKeys.size : 0
    });

    // Step 2: Verify the owner's wallet signature over the exact payload sent
    const isValidSignature = await walletService.verifySignature(
      record.owner,
      JSON.stringify(payload),
      signature
    );
    if (!isValidSignature) {
      return res.status(401).json({
        error: 'Invalid signature',
        message: 'Payload must be signed by the record owner (CIP-8)'
      });
    }

    auditLogger.logger.info('[ProposeShare] Owner signature verified');

    // Step 3: Compute wrappedKeys for new actors (X25519 ECDH + HKDF + AES-GCM).
    // Each actor gets the CEK wrapped under its own X25519 public key, so the
    // Hydra snapshot never carries the plaintext CEK.
    const cek = await cekManager.getTempCEK(record.recordId);

    if (!cek) {
      return res.status(500).json({
        error: 'CEK not available',
        message: 'Record encryption key not found in memory. Please re-upload the record.'
      });
    }

    const ACTOR_MAP = { patient: '01', doctor: '02', hospital: '03', insurance: '04' };
    const actorIds = payload.actors.map((label) => ACTOR_MAP[label] || label);
    const unknown = actorIds.filter((id) => !ACTOR_IDS.has(id));
    if (unknown.length) {
      return res.status(400).json({ error: 'Unknown actors', actors: unknown });
    }

    const cekBuffer = Buffer.isBuffer(cek) ? cek : Buffer.from(cek, 'base64');
    const wrappedKeys = await Promise.all(actorIds.map(async (actorId) => {
      const recipientPub = await cryptoService.loadActorX25519PublicKey(actorId);
      const { wrappedKey, ephemeralPublicKey } = cryptoService.wrapKeyX25519(cekBuffer, recipientPub);
      return {
        actorId,
        wrappedKey: wrappedKey.toString('base64'),
        ephemeralPublicKey: cryptoService.keyToBase64(ephemeralPublicKey)
      };
    }));
    
    auditLogger.logger.info('[ProposeShare] Wrapped keys computed', {
      count: wrappedKeys.length,
      actors: wrappedKeys.map(wk => wk.actorId)
    });
    
    // Step 4: Build update payload for Hydra
    const updatePayload = {
      type: 'SHARE_RECORD',
      recordId: payload.recordId,
      cidHash: payload.cidHash || record.cid,
      wrappedKeys,
      author: record.owner,  // signature above was verified against this address
      timestamp: payload.timestamp || Date.now()
    };
    
    // Step 5: Propose to Hydra head
    const { getHydraClient } = require('../services/hydraClient');
    const hydraClient = getHydraClient();
    
    const hydraResponse = await hydraClient.proposeUpdate(headId, updatePayload);
    
    auditLogger.logger.info('[ProposeShare] Hydra update proposed', {
      status: hydraResponse.status,
      snapshotId: hydraResponse.snapshotId,
      epoch: hydraResponse.epoch
    });
    
    // Step 6: Persist snapshot if accepted
    if (hydraResponse.status !== 'accepted') {
      return res.status(409).json({
        error: 'Update not accepted by Hydra',
        status: hydraResponse.status,
        details: hydraResponse
      });
    }
    
    const HydraSnapshot = require('../models/hydraSnapshotModel');
    const snapshot = await HydraSnapshot.createFromHydraResponse(hydraResponse, headId);
    
    // Step 7: Update record with snapshot reference (optional)
    if (!record.hydraSnapshots) {
      record.hydraSnapshots = [];
    }
    record.hydraSnapshots.push({
      snapshotId: snapshot.snapshotId,
      epoch: snapshot.epoch,
      createdAt: snapshot.createdAt
    });
    await record.save();
    
    auditLogger.logger.info('[ProposeShare] Snapshot persisted', {
      snapshotId: snapshot.snapshotId,
      dbId: snapshot._id,
      recordsInSnapshot: snapshot.records.length
    });
    
    // Success response
    res.json({
      success: true,
      recordId: payload.recordId,
      headId,
      snapshot: {
        snapshotId: snapshot.snapshotId,
        epoch: snapshot.epoch,
        status: snapshot.status,
        recordsCount: snapshot.records.length,
        acceptedAt: snapshot.acceptedAt
      },
      actors: wrappedKeys.map(wk => wk.actorId),
      message: 'Record sharing proposed and accepted via Hydra Layer-2'
    });
    
  } catch (error) {
    auditLogger.logger.error('[ProposeShare] Failed', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to propose share',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

module.exports = {
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
};
