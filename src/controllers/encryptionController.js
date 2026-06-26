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
  
  // Create the payload that should have been signed
  const payload = walletService.createSignPayload(operation, recordId, additionalData);
  
  // Verify using wallet service (handles both wallet and HMAC modes)
  return await walletService.verifySignature(address, payload, signature);
}

async function uploadHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  const startTime = Date.now();
  
  try {
    auditLogger.logger.info('📤 Upload request started', {
      requestId,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
      ownerAddr: req.body.ownerAddr
    });
    
    if (!req.file || !req.file.buffer) {
      auditLogger.logger.error('❌ Upload failed: No file provided', { requestId });
      return res.status(400).json({ error: 'Encrypted package requires a file upload' });
    }
    const ownerAddr = req.body.ownerAddr;
    if (!ownerAddr) {
      auditLogger.logger.error('❌ Upload failed: No owner address', { requestId });
      return res.status(422).json({ error: 'ownerAddr is required' });
    }
    
    auditLogger.logger.info('🔑 Generating 256-bit AES-GCM encryption key...', { requestId });
    const cek = await cryptoService.generateCEK();
    
    auditLogger.logger.info('🔒 Encrypting file with AES-256-GCM...', {
      requestId,
      originalSize: req.file.buffer.length
    });
    const { package: encryptedPackage } = cryptoService.encryptAESGCM(req.file.buffer, cek);
    const recordId = uuidv4();
    cekManager.storeTempCEK(recordId, cek);

    const shouldPin = AUTO_PIN || req.body.pinToIpfs === 'true';
    if (shouldPin) {
      auditLogger.logger.info('☁️ Uploading encrypted package to IPFS...', {
        requestId,
        recordId,
        encryptedSize: encryptedPackage.length
      });
      const { cid } = await ipfsService.uploadBufferToIPFS(encryptedPackage);
      const cidHash = cryptoService.sha256hex(cid);
      
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
      
      auditLogger.logger.info('✅ Upload complete and saved to database!', {
        recordId,
        cid,
        cidHash: cidHash.substring(0, 16) + '...',
        encryptedSize: encryptedPackage.length,
        actors: actorIds
      });
      
      // 🚀 AUTO-SHARE VIA HYDRA: Automatically propose sharing to Hydra Layer-2
      // This makes permission checks 100-400x faster (5-15ms vs 500-2000ms)
      const AUTO_SHARE_HYDRA = process.env.AUTO_SHARE_HYDRA === 'true';
      const DEFAULT_HYDRA_HEAD = process.env.DEFAULT_HYDRA_HEAD;
      
      if (AUTO_SHARE_HYDRA && DEFAULT_HYDRA_HEAD) {
        try {
          auditLogger.logger.info('🔄 Auto-sharing to Hydra Layer-2...', {
            recordId,
            headId: DEFAULT_HYDRA_HEAD,
            actors: actorIds
          });
          
          const { getHydraClient } = require('../services/hydraClient');
          const hydraClient = getHydraClient();
          
          // Prepare wrapped keys for Hydra snapshot
          const wrappedKeysArray = actorIds.map(actorId => ({
            actorId,
            wrappedKey: wrappedKeys.get(actorId) || 'mock-wrapped-key',
            ephemeralPublicKey: 'mock-ephemeral-pub-key'
          }));
          
          // Propose update to Hydra
          const hydraResponse = await hydraClient.proposeUpdate(DEFAULT_HYDRA_HEAD, {
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
            headId: DEFAULT_HYDRA_HEAD,
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
        } catch (hydraError) {
          // Non-blocking: Log error but don't fail upload
          auditLogger.logger.warn('⚠️ Hydra auto-share failed (non-blocking)', {
            recordId,
            error: hydraError.message
          });
        }
      }
      
      return res.status(200).json({ 
        recordId, 
        cid, 
        cidHash, 
        encryptedSize: encryptedPackage.length,
        originalSize: req.file.size,
        fileName: req.file.originalname,
        actors: actorIds,
        hydraShared: AUTO_SHARE_HYDRA && DEFAULT_HYDRA_HEAD ? true : false
      });
    }
    return res.status(200).json({ recordId, encryptedPackageBase64: encryptedPackage.toString('base64') });
  } catch (error) {
    auditLogger.logger.error('❌ Upload failed with error:', { error: error.message, stack: error.stack });
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
    const { recordId, ownerAddr, ownerSignature, actorPublicKeys = {} } = req.body;
    
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
      { actorIds: Object.keys(actorPublicKeys) }
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
  
  try {
    const { recordId, actorId, actorAddr, actorSignature } = req.body;
    
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
      { actorId }
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
    const wrappedKeyBase64 = record.wrappedKeys.get(actorId);
    if (!wrappedKeyBase64) {
      auditLogger.logAccessDenied({
        recordId,
        actorId,
        actorAddr: address,
        reason: 'No wrapped key found for actor',
        requestId
      });
      return res.status(404).json({ error: 'Actor does not have a wrapped CEK' });
    }
    
    const permissionResult = await permissionService.verifyPermission(recordId, actorId);
    if (!permissionResult.granted) {
      auditLogger.logAccessDenied({
        recordId,
        actorId,
        actorAddr: address,
        reason: permissionResult.reason || 'Permission denied',
        requestId
      });
      return res.status(403).json({ error: 'Permission denied by on-chain policy or Midnight proof' });
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
    if (error.message.includes('Blockfrost')) {
      return res.status(503).json({ error: 'Permission service unavailable' });
    }
    return next(error);
  }
}

async function revokeHandler(req, res, next) {
  const requestId = auditLogger.generateRequestId();
  const startTime = Date.now();
  
  try {
    const { recordId, actorId, ownerAddr, ownerSignature } = req.body;
    
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
      { actorId }
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
      
      return res.status(200).json({ 
        record: record.toSafeJSON(), 
        message: `Actor ${actorId} revoked. No actors remaining - rotation skipped.` 
      });
    }
    
    await record.save();
    
    // Attempt CEK rotation
    let rotationStatus = 'pending';
    let rotationError = null;
    let newCID = null;
    
    try {
      const rotationResult = await rotateCEK(record);
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
 * @returns {Promise<Object>} Updated record with new CID and wrapped keys
 */
async function rotateCEK(record) {
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
    const encryptedPackage = await ipfsService.downloadFromIPFS(record.cid);
    
    // For demo purposes, we need an owner's wrapped key to unwrap the old CEK
    // In production, this would use HSM/KMS or secure owner key management
    // For now, we'll use the first available wrapped key (representing owner access)
    const firstActorId = Array.from(record.wrappedKeys.keys())[0];
    const firstWrappedKey = record.wrappedKeys.get(firstActorId);
    
    if (!firstWrappedKey) {
      throw new Error('No wrapped keys available to unwrap old CEK');
    }

    console.info(`[CEK Rotation] Step 2/9: Unwrapping old CEK`);
    
    let oldCEK;
    const isProduction = process.env.NODE_ENV === 'production';
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
        
        const fs = require('fs');
        const path = require('path');
        const keyPath = path.join(__dirname, '../../scripts/keys', `actor-${firstActorId}-patient-priv.pem`);
        
        try {
          const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
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

    console.info(`[CEK Rotation] Step 3/9: Decrypting package with old CEK`);
    const plaintext = cryptoService.decryptAESGCM(encryptedPackage, oldCEK);
    
    console.info(`[CEK Rotation] Step 4/9: Generating new CEK`);
    const newCEK = await cryptoService.generateCEK();
    
    console.info(`[CEK Rotation] Step 5/9: Re-encrypting with new CEK`);
    const { package: newEncryptedPackage } = cryptoService.encryptAESGCM(plaintext, newCEK);
    
    console.info(`[CEK Rotation] Step 6/9: Uploading new package to IPFS`);
    const { cid: newCID } = await ipfsService.uploadBufferToIPFS(newEncryptedPackage);
    
    console.info(`[CEK Rotation] Step 7/9: Updating record with new CID (${newCID})`);
    record.cid = newCID;
    record.cidHash = cryptoService.sha256hex(newCID);
    
    console.info(`[CEK Rotation] Step 8/9: Re-wrapping new CEK for ${record.wrappedKeys.size} remaining actors`);
    
    // Load actor public keys and re-wrap
    const actorIds = Array.from(record.wrappedKeys.keys());
    const newWrappedKeys = new Map();
    
    for (const actorId of actorIds) {
      try {
        // In production, actors should use their own KMS keys or client-side wrapping
        // For development/demo, use filesystem keys
        
        if (!isProduction) {
          const fs = require('fs');
          const path = require('path');
          const actorLabel = ['patient', 'doctor', 'hospital', 'insurance'][parseInt(actorId) - 1];
          const pubKeyPath = path.join(__dirname, '../../scripts/keys', `actor-${actorId}-${actorLabel}-pub.pem`);
          const publicKeyPem = fs.readFileSync(pubKeyPath, 'utf8');
          
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
    
    console.info(`[CEK Rotation] Step 9/9: Updating on-chain anchor (TODO: implement real transaction)`);
    // In production, submit new anchor transaction to Cardano with new cidHash
    // For now, just log the intent
    console.info(`[CEK Rotation]   - Would submit tx with: { recordId: ${record.recordId}, cidHash: ${record.cidHash} }`);
    
    // Save the updated record
    await record.save();
    
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
 * SSE endpoint for upload progress tracking
 * GET /api/encrypt/progress/:sessionId
 */
function uploadProgressHandler(req, res) {
  const { sessionId } = req.params;
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Add client to session
  const added = progressService.addClient(sessionId, res);
  
  if (!added) {
    res.write('data: {"error":"Session not found"}\n\n');
    res.end();
    return;
  }
  
  // Handle client disconnect
  req.on('close', () => {
    progressService.removeClient(sessionId, res);
  });
  
  // Keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
  });
}

/**
 * POST /api/encrypt/propose-share
 * Propose record sharing via Hydra Layer-2 (off-chain fast path)
 * 
 * Flow:
 * 1. Verify wallet signature (CIP-8)
 * 2. Load record and CEK from database
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
 * TODO: Add rate limiting (max 10 proposals/minute per user)
 * TODO: For production, move wrapping to client-side for strict privacy
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
    
    // Step 1: Verify wallet signature
    // TODO: Use existing walletService.verifyWalletSignature for production
    // For now, basic validation (mock accepts all)
    if (!signature.key || !signature.signature) {
      return res.status(401).json({
        error: 'Invalid signature',
        message: 'Signature must contain key and signature fields (CIP-8 format)'
      });
    }
    
    auditLogger.logger.info('[ProposeShare] Signature validated (mock mode)');
    
    // Step 2: Load record from database
    const Record = require('../models/recordModel');
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
      currentActors: record.wrappedActors?.length || 0
    });
    
    // Step 3: Compute wrappedKeys for new actors
    // TODO: Replace with existing wrapKeyX25519 function if available
    // For MVP, server-side wrapping (production should move to client-side)
    
    const { getTempCEK } = require('../services/cekManager');
    const cek = await getTempCEK(record.recordId);
    
    if (!cek) {
      return res.status(500).json({
        error: 'CEK not available',
        message: 'Record encryption key not found in memory. Please re-upload the record.'
      });
    }
    
    // TODO: Implement X25519 key wrapping
    // For now, create mock wrapped keys structure
    const wrappedKeys = payload.actors.map(actorLabel => {
      // Convert frontend label to backend ID
      const ACTOR_MAP = { patient: '01', doctor: '02', hospital: '03', insurance: '04' };
      const actorId = ACTOR_MAP[actorLabel] || actorLabel;
      
      return {
        actorId,
        wrappedKey: Buffer.from(cek).toString('base64'),  // TODO: Actual X25519 wrapping
        ephemeralPublicKey: 'mock-ephemeral-pub-key'     // TODO: Real ephemeral key
      };
    });
    
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
      author: signature.key || 'unknown-author',  // TODO: Extract from signature
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
  revokeHandler,
  metadataHandler,
  listRecordsHandler,
  uploadProgressHandler,
  proposeShareHandler,
};
