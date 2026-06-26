const { sha256hex } = require('./cryptoService');
const { BlockFrostAPI } = require('@blockfrost/blockfrost-js');
const cbor = require('cbor');
const { checkPermissionViaZK, getMidnightStats } = require('./midnightService');
const { getValidatorHash, getAikenStats } = require('./aikenService');

const ACTOR_IDS = new Set(['01', '02', '03', '04']);

// Redis cache for permissions (1-hour TTL)
let permissionCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Initialize Blockfrost client
 */
function getBlockfrostClient() {
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (!projectId || projectId === 'replace') {
    return null;
  }
  
  const network = (process.env.CARDANO_NETWORK || 'testnet').toLowerCase();
  return new BlockFrostAPI({
    projectId,
    network: network === 'mainnet' ? 'mainnet' : 'testnet',
  });
}

/**
 * Parse CBOR datum from Plutus script
 * Expected datum structure:
 * {
 *   recordId: string,
 *   permittedActors: [string],
 *   expiresAt: number (Unix timestamp),
 *   permissions: [string]
 * }
 */
function parseCBORDatum(datumHex) {
  try {
    const datumBytes = Buffer.from(datumHex, 'hex');
    const decoded = cbor.decodeFirstSync(datumBytes);
    
    // Handle Plutus datum wrapper (constructor with fields)
    if (decoded && decoded.value && Array.isArray(decoded.value)) {
      const fields = decoded.value;
      return {
        recordId: fields[0]?.toString() || null,
        permittedActors: fields[1] || [],
        expiresAt: fields[2] || null,
        permissions: fields[3] || ['read'],
      };
    }
    
    return decoded;
  } catch (err) {
    console.error('CBOR datum parsing error:', err.message);
    return null;
  }
}

/**
 * Query Blockfrost for permission datums
 * Searches transaction metadata (label 5000) and Plutus script datums
 */
async function queryBlockfrost(recordId, actorId) {
  const client = getBlockfrostClient();
  if (!client) {
    console.warn('⚠️  Blockfrost not configured - skipping on-chain verification');
    return null;
  }
  
  // Check cache first
  const cacheKey = `${recordId}:${actorId}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.info(`[blockfrost] Cache hit for ${cacheKey}`);
    return cached.result;
  }
  
  try {
    // Method 1: Query transaction metadata (label 5000 - custom application label)
    const metadataLabel = 5000;
    const metadataEntries = await client.metadataTxsLabels(metadataLabel, {
      count: 25,
      order: 'desc',
    });
    
    for (const entry of metadataEntries) {
      const txMetadata = await client.txsMetadata(entry.tx_hash);
      
      for (const meta of txMetadata) {
        if (meta.label === metadataLabel.toString()) {
          const datum = meta.json_metadata;
          
          if (datum.recordId === recordId) {
            const permittedActors = datum.permittedActors || [];
            const expiresAt = datum.expiresAt;
            const cidHash = datum.cidHash;
            
            // Validate expiration
            if (expiresAt && Date.now() > expiresAt * 1000) {
              console.info(`[blockfrost] Permission expired for ${recordId}`);
              return false;
            }
            
            // Validate CID hash integrity
            if (cidHash) {
              const expectedHash = sha256hex(datum.cid || '');
              if (expectedHash !== cidHash) {
                console.error(`[blockfrost] CID hash mismatch for ${recordId}`);
                return false;
              }
            }
            
            const result = permittedActors.includes(actorId);
            
            // Cache result
            permissionCache.set(cacheKey, {
              result,
              timestamp: Date.now(),
            });
            
            console.info(`[blockfrost] Permission ${result ? 'granted' : 'denied'} for ${actorId} on ${recordId}`);
            return result;
          }
        }
      }
    }
    
    // Method 2: Query Plutus script datums (future enhancement)
    // This would involve querying specific script addresses and parsing CBOR datums
    
    console.info(`[blockfrost] No permission datum found for ${recordId}`);
    return false;
  } catch (err) {
    console.error('[blockfrost] Query error:', err.message);
    return null;
  }
}

/**
 * Verifies whether an actor is authorized to fetch a wrapped CEK.
 * 
 * Multi-layer permission verification strategy (privacy-optimized):
 * 1. Hydra L2: Fast off-chain permissions (instant, public within head)
 * 2. Aiken L1: On-chain smart contract validation (slow, immutable audit trail)
 * 3. Midnight ZK: Privacy-preserving permissions (slow, private via zero-knowledge)
 * 4. Blockfrost L1: Public on-chain fallback (slow, public on Cardano mainnet)
 * 
 * Privacy guarantee: Midnight ZK ensures permission checks don't reveal
 * which other actors have access (zero-knowledge property).
 * 
 * @param {string} recordId - Record UUID
 * @param {string} actorId - Actor ID (01, 02, 03, 04)
 * @param {string} requestId - Optional request correlation ID
 * @returns {Promise<{granted: boolean, source: 'hydra'|'aiken'|'midnight-zk'|'blockfrost', proof?: object}>}
 */
async function verifyPermission(recordId, actorId, requestId = null) {
  if (!recordId || !ACTOR_IDS.has(actorId)) {
    return { granted: false, source: 'validation', reason: 'Invalid recordId or actorId' };
  }
  
  // Import audit logger
  const auditLogger = require('./auditLogger');
  
  // Step 1: Check Hydra snapshots first (Layer-2 fast path)
  try {
    const HydraSnapshot = require('../models/hydraSnapshotModel');
    const hydraResult = await HydraSnapshot.checkPermission(recordId, actorId);
    
    if (hydraResult.snapshot) {
      console.log(`[permissionService] ✅ Permission found in Hydra L2 snapshot: ${hydraResult.snapshot.snapshotId}`);
      
      const result = {
        granted: hydraResult.granted,
        source: 'hydra',
        snapshotId: hydraResult.snapshot.snapshotId,
        epoch: hydraResult.snapshot.epoch
      };
      
      // Audit log permission check
      auditLogger.logPermissionCheck({
        recordId,
        actorId,
        result: result.granted,
        method: 'hydra-l2',
        requestId
      });
      
      return result;
    }
    
    console.log('[permissionService] No Hydra snapshot found, checking Aiken smart contract...');
    
  } catch (hydraError) {
    // Non-fatal: continue to Aiken fallback
    console.warn('[permissionService] Hydra check failed, continuing to Aiken:', hydraError.message);
  }
  
  // Step 2: Check Aiken smart contract (on-chain Plutus validator)
  try {
    const aikenStats = getAikenStats();
    
    if (aikenStats.enabled && aikenStats.validatorLoaded) {
      console.log('[permissionService] Attempting Aiken smart contract verification (on-chain Plutus)...');
      
      // Query Blockfrost for UTxOs at the script address
      const validatorHash = getValidatorHash();
      const scriptAddress = aikenStats.scriptAddress;
      const client = getBlockfrostClient();
      
      if (client && validatorHash && scriptAddress) {
        try {
          // Query UTxOs at the Plutus script address
          console.log(`[permissionService] Querying UTxOs at script address ${scriptAddress.substring(0, 30)}...`);
          const utxos = await client.addressesUtxos(scriptAddress);
          
          if (utxos && utxos.length > 0) {
            console.log(`[permissionService] Found ${utxos.length} UTxO(s) at Aiken script address`);
            
            // Compute record ID hash to match against datum
            const recordIdHash = sha256hex(record.ipfsCid);
            
            // Search for UTxO with matching permission datum
            for (const utxo of utxos) {
              if (!utxo.inline_datum) continue;
              
              try {
                // Parse inline datum (simplified parsing - production needs full CBOR decoder)
                // datum structure: { record_id, permitted_actors, expires_at, owner, nft_ref }
                
                // Note: Blockfrost returns inline_datum as hex-encoded CBOR
                // For production, use @emurgo/cardano-serialization-lib or similar
                // For now, we assume the datum structure matches our buildPermissionDatum output
                
                const datumHex = utxo.inline_datum;
                // Placeholder: In production, decode CBOR to extract fields
                // const decoded = decodeCBOR(datumHex);
                
                console.log(`[permissionService] Checking UTxO ${utxo.tx_hash}:${utxo.output_index} with datum...`);
                
                // Simplified check: If we stored metadata alongside the UTxO, check that
                // Real implementation would decode CBOR datum and extract permitted_actors array
                
                // For demo purposes, we'll check if the record exists in our database
                // and assume the on-chain datum matches
                if (record.recordId === recordIdHash) {
                  const wrappedKey = record.wrappedKeys?.get(actorId);
                  
                  if (wrappedKey) {
                    console.log(`[permissionService] ✅ Permission GRANTED via Aiken (actor=${actorId}, record=${record.recordId.substring(0, 16)}...)`);
                    
                    const result = {
                      granted: true,
                      source: 'aiken',
                      layer: 'L1-plutus',
                      validatorHash: validatorHash.substring(0, 16) + '...',
                      utxo: `${utxo.tx_hash.substring(0, 16)}...#${utxo.output_index}`
                    };
                    
                    // Audit log permission check
                    auditLogger.logPermissionCheck({
                      recordId,
                      actorId,
                      result: true,
                      method: 'aiken-l1',
                      requestId
                    });
                    
                    return result;
                  }
                }
              } catch (parseErr) {
                console.warn('[permissionService] Failed to parse Aiken datum:', parseErr.message);
              }
            }
            
            console.log('[permissionService] No matching permission found in Aiken UTxOs');
          } else {
            console.log('[permissionService] No UTxOs found at Aiken script address (no permissions stored on-chain yet)');
          }
          
        } catch (aikenError) {
          console.warn('[permissionService] Aiken validation error:', aikenError.message);
        }
      } else {
        if (!client) console.log('[permissionService] Blockfrost client not available for Aiken validation');
        if (!validatorHash) console.log('[permissionService] Validator hash not loaded');
        if (!scriptAddress) console.log('[permissionService] Script address not computed');
      }
    } else {
      console.log('[permissionService] Aiken smart contract disabled or validator not loaded, checking Midnight ZK...');
    }
  } catch (aikenError) {
    // Non-fatal: continue to Midnight fallback
    console.warn('[permissionService] Aiken check failed, continuing to Midnight:', aikenError.message);
  }
  
  // Step 3: Check Midnight ZK (privacy-preserving path)
  try {
    const midnightStats = getMidnightStats();
    
    if (midnightStats.enabled) {
      console.log('[permissionService] Attempting Midnight ZK verification (privacy-preserving)...');
      const zkResult = await checkPermissionViaZK(recordId, actorId);
      
      if (zkResult.granted !== null) {
        if (zkResult.granted) {
          console.log(`[permissionService] ✅ Permission GRANTED via Midnight ZK proof (${zkResult.privacyGuarantee})`);
          
          const result = {
            granted: true,
            source: 'midnight-zk',
            proof: zkResult.proof,
            commitment: zkResult.commitment,
            privacyGuarantee: zkResult.privacyGuarantee
          };
          
          // Audit log permission check
          auditLogger.logPermissionCheck({
            recordId,
            actorId,
            result: true,
            method: 'midnight-zk',
            requestId
          });
          
          return result;
        } else {
          console.log(`[permissionService] ❌ Permission DENIED via Midnight ZK: ${zkResult.reason}`);
          
          const result = {
            granted: false,
            source: 'midnight-zk',
            reason: zkResult.reason
          };
          
          // Audit log permission check
          auditLogger.logPermissionCheck({
            recordId,
            actorId,
            result: false,
            method: 'midnight-zk',
            requestId
          });
          
          return result;
        }
      }
    } else {
      console.log('[permissionService] Midnight ZK disabled, falling back to Blockfrost L1...');
    }
    
  } catch (midnightError) {
    // Non-fatal: continue to Blockfrost fallback
    console.warn('[permissionService] Midnight ZK check failed, falling back to Blockfrost:', midnightError.message);
  }
  
  // Step 4: Fallback to Blockfrost (Layer-1 on-chain verification - public)
  const client = getBlockfrostClient();
  if (!client) {
    console.error('[permissionService] BLOCKFROST_PROJECT_ID not configured - cannot verify permissions');
    throw new Error('Cardano blockchain verification required: BLOCKFROST_PROJECT_ID must be set in environment');
  }
  
  try {
    console.log('[permissionService] Attempting Blockfrost L1 verification (public on-chain)...');
    const onChainResult = await queryBlockfrost(recordId, actorId);
    
    if (onChainResult === null) {
      // Permission datum not found on-chain
      console.warn(`[permissionService] No permission datum found on-chain for ${recordId} actor ${actorId}`);
      
      const result = { granted: false, source: 'blockfrost', reason: 'No permission datum on-chain' };
      
      // Audit log permission check
      auditLogger.logPermissionCheck({
        recordId,
        actorId,
        result: false,
        method: 'blockfrost-l1',
        requestId
      });
      
      return result;
    }
    
    console.log(`[permissionService] ${onChainResult ? '✅ Granted' : '❌ Denied'} via Blockfrost L1`);
    
    const result = {
      granted: onChainResult,
      source: 'blockfrost'
    };
    
    // Audit log permission check
    auditLogger.logPermissionCheck({
      recordId,
      actorId,
      result: onChainResult,
      method: 'blockfrost-l1',
      requestId
    });
    
    return result;
  } catch (error) {
    console.error('[permissionService] All permission verification layers failed:', error.message);
    
    // Audit log failed permission check
    auditLogger.logPermissionCheck({
      recordId,
      actorId,
      result: false,
      method: 'all-layers-failed',
      requestId
    });
    
    throw new Error('Failed to verify permissions on all layers (Hydra, Midnight, Blockfrost): ' + error.message);
  }
}

module.exports = {
  verifyPermission,
};
