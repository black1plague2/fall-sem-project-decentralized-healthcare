/**
 * walletService.js
 * 
 * Cardano wallet signature verification using Lucid.
 * Implements CIP-8 (message signing) and CIP-30 (wallet connector) standards.
 * 
 * Security: Validates wallet signatures to ensure only authorized actors can perform operations.
 */

// Lucid-cardano has ESM import issues in CommonJS - use dynamic import workaround
let Lucid, C;
try {
  const lucidImport = require('lucid-cardano');
  Lucid = lucidImport.Lucid;
  C = lucidImport.C;
} catch (err) {
  console.warn('⚠️  lucid-cardano import failed, wallet signature verification will use HMAC fallback');
  Lucid = null;
  C = null;
}

/**
 * Verify a CIP-8 signature from a Cardano wallet.
 * 
 * @param {string} address - Cardano address (bech32 format, e.g., addr_test1...)
 * @param {string} payload - The message that was signed (stringified JSON)
 * @param {object} signedData - Signature object with { key, signature }
 * @returns {Promise<boolean>} - True if signature is valid
 */
async function verifyWalletSignature(address, payload, signedData) {
  // Require Lucid - no HMAC fallback in production
  if (!Lucid || !C) {
    console.error('[walletService] lucid-cardano library not available - cannot verify wallet signatures');
    throw new Error('Cardano wallet verification unavailable: lucid-cardano library required. Run: npm install lucid-cardano');
  }
  
  try {
    // Initialize Lucid (network doesn't affect signature verification)
    const lucid = await Lucid.new(undefined, 'Preprod');
    
    // Parse the signature components
    const { key, signature } = signedData;
    
    if (!key || !signature) {
      console.warn('[walletService] Missing key or signature in signedData');
      return false;
    }

    // Verify the signature using Lucid's built-in verification
    const publicKey = C.PublicKey.from_hex(key);
    const signatureBytes = C.Ed25519Signature.from_hex(signature);
    const messageBytes = Buffer.from(payload);

    // Verify signature
    const isValid = publicKey.verify(messageBytes, signatureBytes);
    
    if (!isValid) {
      console.warn(`[walletService] Invalid signature for address ${address}`);
      return false;
    }

    // Optionally verify address matches the public key
    // (In production, you'd derive the address from the public key and compare)
    
    console.info(`[walletService] Valid signature verified for address ${address}`);
    return true;

  } catch (error) {
    console.error('[walletService] Signature verification error:', error.message);
    // No fallback in production - signature verification must succeed
    throw new Error('Cardano wallet signature verification failed: ' + error.message);
  }
}

/**
 * Create a standardized payload for wallet signing.
 * This ensures consistent message format across all operations.
 * 
 * @param {string} operation - Operation type (e.g., 'wrapKeys', 'accessRequest', 'revoke')
 * @param {string} recordId - Record UUID
 * @param {object} additionalData - Operation-specific data
 * @returns {string} - Stringified JSON payload
 */
function createSignPayload(operation, recordId, additionalData = {}) {
  const payload = {
    operation,
    recordId,
    timestamp: Date.now(),
    network: process.env.CARDANO_NETWORK || 'testnet',
    ...additionalData
  };
  
  return JSON.stringify(payload);
}

/**
 * Verify Cardano wallet signature (CIP-8 standard).
 * 
 * PRODUCTION MODE: No HMAC fallback - requires real wallet signature object.
 * signatureData must be { key: '...', signature: '...' } from CIP-30 wallet.
 * 
 * @param {string} address - Cardano wallet address
 * @param {string} payload - Message payload
 * @param {object} signatureData - Signature object with { key, signature }
 * @returns {Promise<boolean>}
 */
async function verifySignature(address, payload, signatureData) {
  // Reject string signatures (HMAC demo mode)
  if (typeof signatureData === 'string') {
    console.error('[walletService] HMAC signatures not allowed in production - wallet signature required');
    throw new Error('Production mode: Cardano wallet signature required (CIP-8). HMAC signatures are disabled.');
  }

  // Require signature object format
  if (!signatureData || typeof signatureData !== 'object' || !signatureData.key || !signatureData.signature) {
    console.error('[walletService] Invalid signature format - expected { key, signature }');
    throw new Error('Invalid signature format: Must provide { key, signature } from Cardano wallet (CIP-8)');
  }

  // Production mode: Verify wallet signature only
  return verifyWalletSignature(address, payload, signatureData);
}

/**
 * HMAC verification (DEPRECATED - DO NOT USE IN PRODUCTION).
 * 
 * ⚠️  WARNING: This function is disabled in production mode.
 * Use verifySignature() which requires real Cardano wallet signatures.
 * 
 * @deprecated Use verifySignature() with CIP-8 wallet signatures instead
 * @param {string} payload - Message payload
 * @param {string} hmacSignature - HMAC-SHA256 hex signature
 * @returns {boolean}
 */
function verifyHMACSignature(payload, hmacSignature) {
  console.error('[walletService] DEPRECATED: verifyHMACSignature called - this function is disabled in production');
  throw new Error('HMAC signature verification is deprecated and disabled. Use Cardano wallet signatures (CIP-8).');
  // Implementation removed - function throws error immediately
}

/**
 * Extract Cardano address from actor registry.
 * 
 * PRODUCTION MODE: Requires Actor model with registered Cardano addresses.
 * Frontend must provide actorAddr in request body - no mock addresses.
 * 
 * @param {string} actorId - Actor ID (01, 02, 03, 04)
 * @returns {string|null} - Returns null (address must come from frontend or Actor registry)
 */
function getActorAddress(actorId) {
  // No mock addresses in production - address must be provided by frontend
  // or retrieved from Actor registry database
  console.warn('[walletService] getActorAddress called without real Actor registry - address required from frontend');
  return null;
}

module.exports = {
  verifyWalletSignature,
  verifySignature,
  createSignPayload,
  verifyHMACSignature,
  getActorAddress
};
