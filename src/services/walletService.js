/**
 * walletService.js
 *
 * Cardano wallet signature verification.
 * Implements CIP-8 (message signing) and CIP-30 (wallet connector) standards.
 *
 * Security: Validates wallet signatures to ensure only authorized actors can perform operations.
 *
 * Verification is done directly (COSE_Sign1 decode + Ed25519 via Node crypto +
 * Blake2b-224 key hash) rather than through lucid-cardano, which is ESM-only
 * and fails to load from this CommonJS codebase.
 */

const crypto = require('crypto');
const cbor = require('cbor');
const blake2b = require('blake2b');

const blake2b224 = (data) => Buffer.from(blake2b(28).update(data).digest());

// Signed payloads older than this are rejected (replay protection).
const MAX_SIGNATURE_AGE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// bech32 decoding (BIP-173, no 90-char limit — Cardano addresses are longer)
// ---------------------------------------------------------------------------
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32Decode(str) {
  const lower = str.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) throw new Error('Invalid bech32 string');
  const hrp = lower.slice(0, pos);
  const data = [];
  for (const ch of lower.slice(pos + 1)) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v === -1) throw new Error('Invalid bech32 character');
    data.push(v);
  }
  const hrpExpand = [...hrp].map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (bech32Polymod(hrpExpand.concat(data)) !== 1) throw new Error('Invalid bech32 checksum');

  // Convert 5-bit groups to bytes
  let acc = 0, bits = 0;
  const out = [];
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return { hrp, bytes: Buffer.from(out) };
}

/** Accepts a bech32 or hex-encoded Cardano address, returns raw bytes. */
function addressToBytes(address) {
  if (/^[0-9a-fA-F]+$/.test(address)) return Buffer.from(address, 'hex');
  return bech32Decode(address).bytes;
}

// CBOR maps decode to a Map when keys are mixed (ints + strings), else a plain object.
function mapGet(m, key) {
  if (m instanceof Map) return m.get(key);
  return m ? m[key] : undefined;
}

function ed25519Verify(publicKey, message, signature) {
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const keyObject = crypto.createPublicKey({
    key: Buffer.concat([spkiPrefix, publicKey]),
    format: 'der',
    type: 'spki',
  });
  return crypto.verify(null, message, keyObject, signature);
}

/**
 * Verify a CIP-8 signature from a Cardano wallet (CIP-30 signData output).
 *
 * Checks that:
 *  1. the COSE_Sign1 Ed25519 signature is valid for the COSE_Key public key,
 *  2. the signed payload is exactly `payload`,
 *  3. the address in the protected header is `address`, and
 *  4. `address`'s key-hash credential is Blake2b-224(public key),
 *     so the signer actually controls that address.
 *
 * @param {string} address - Cardano address (bech32 format, e.g., addr_test1...)
 * @param {string} payload - The message that was signed (stringified JSON)
 * @param {object} signedData - Signature object with { key, signature } (hex COSE_Key / COSE_Sign1)
 * @returns {Promise<boolean>} - True if signature is valid
 */
async function verifyWalletSignature(address, payload, signedData) {
  try {
    const { key, signature } = signedData || {};

    if (!key || !signature) {
      console.warn('[walletService] Missing key or signature in signedData');
      return false;
    }

    // COSE_Key: { 1: 1 (OKP), 3: -8 (EdDSA), -1: 6 (Ed25519), -2: <public key> }
    const coseKey = cbor.decodeFirstSync(Buffer.from(key, 'hex'));
    const publicKey = Buffer.from(mapGet(coseKey, -2) || []);
    if (publicKey.length !== 32) {
      console.warn('[walletService] COSE_Key does not contain a 32-byte Ed25519 key');
      return false;
    }

    // COSE_Sign1: [protected bstr, unprotected map, payload bstr, signature bstr] (optionally tag 18)
    let sign1 = cbor.decodeFirstSync(Buffer.from(signature, 'hex'));
    if (sign1 instanceof cbor.Tagged) sign1 = sign1.value;
    if (!Array.isArray(sign1) || sign1.length !== 4) {
      console.warn('[walletService] Malformed COSE_Sign1');
      return false;
    }
    const [protectedBytes, unprotected, signedPayload, sigBytes] = sign1;

    // 1. Ed25519 signature over Sig_structure
    // (cbor's sync encode() emits truncated output on newer Node versions; encodeAsync is correct)
    const sigStructure = await cbor.encodeAsync(['Signature1', protectedBytes, Buffer.alloc(0), signedPayload]);
    if (!ed25519Verify(publicKey, sigStructure, Buffer.from(sigBytes))) {
      console.warn(`[walletService] Invalid signature for address ${address}`);
      return false;
    }

    // 2. Payload must be what we expect (some wallets sign its Blake2b-224 hash)
    const expected = Buffer.from(payload, 'utf8');
    const hashed = mapGet(unprotected, 'hashed') === true;
    const expectedSigned = hashed ? blake2b224(expected) : expected;
    if (!signedPayload || !Buffer.from(signedPayload).equals(expectedSigned)) {
      console.warn('[walletService] Signed payload does not match expected payload');
      return false;
    }

    // 3. Protected header address must match the claimed address
    const protectedMap = protectedBytes.length ? cbor.decodeFirstSync(protectedBytes) : null;
    const headerAddress = mapGet(protectedMap, 'address');
    const addrBytes = addressToBytes(address);
    if (!headerAddress || !Buffer.from(headerAddress).equals(addrBytes)) {
      console.warn('[walletService] Signing address does not match claimed address');
      return false;
    }

    // 4. Address's key-hash credential must be the hash of the signing key.
    // Header types 0,2,4,6 (base/pointer/enterprise with payment key) and
    // 14 (reward address with stake key) keep the key hash at bytes 1..28.
    const addrType = addrBytes[0] >> 4;
    if (![0, 2, 4, 6, 14].includes(addrType)) {
      console.warn(`[walletService] Unsupported address type ${addrType} (script address?)`);
      return false;
    }
    const keyHash = blake2b224(publicKey);
    if (!addrBytes.subarray(1, 29).equals(keyHash)) {
      console.warn('[walletService] Signing key does not control the claimed address');
      return false;
    }

    console.info(`[walletService] Valid signature verified for address ${address}`);
    return true;

  } catch (error) {
    console.error('[walletService] Signature verification error:', error.message);
    return false;
  }
}

/** Rejects payloads whose embedded timestamp is missing, in the future, or stale. */
function isFreshPayload(payload) {
  try {
    const { timestamp } = JSON.parse(payload);
    const age = Date.now() - Number(timestamp);
    return Number.isFinite(age) && age >= -60 * 1000 && age <= MAX_SIGNATURE_AGE_MS;
  } catch {
    return false;
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
  // ============================================================
  // DEMO MODE PLACEHOLDER: bypasses real CIP-8 wallet verification
  // so the pipeline can be demoed without an Eternl extension.
  // Set DEMO_MODE=false in .env to require real wallet signatures
  // (verifyWalletSignature below stays fully implemented for that).
  // ============================================================
  if (process.env.DEMO_MODE === 'true') {
    if (!signatureData) {
      return false;
    }
    console.warn(`[walletService] DEMO_MODE: bypassing wallet signature check for ${address ? address.substring(0, 20) + '...' : 'unknown address'}`);
    return true;
  }

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

  if (!isFreshPayload(payload)) {
    console.warn('[walletService] Rejected stale or undated signed payload');
    return false;
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
  bech32Decode,
  verifySignature,
  createSignPayload,
  verifyHMACSignature,
  getActorAddress
};
