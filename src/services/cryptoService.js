const crypto = require('crypto');

const AES_ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit tag ensures integrity
const X25519_KEY_LENGTH = 32; // X25519 keys are 32 bytes

/**
 * @returns {Promise<Buffer>} 32-byte randomly generated CEK
 */
async function generateCEK() {
  return crypto.randomBytes(32);
}

/**
 * @returns {Buffer} 12-byte IV for AES-GCM
 */
function generateIV() {
  return crypto.randomBytes(IV_LENGTH);
}

/**
 * Encrypts a buffer using AES-256-GCM.
 * The resulting package layout is: [IV(12 bytes)] || [AuthTag(16 bytes)] || [Ciphertext].
 * Storing IV+tag alongside ciphertext allows deterministic parsing while keeping secrets separate.
 * @param {Buffer} plainBuffer
 * @param {Buffer} cek
 * @returns {{package: Buffer, ivBase64: string, authTagBase64: string}}
 */
function encryptAESGCM(plainBuffer, cek) {
  if (!Buffer.isBuffer(plainBuffer) || !Buffer.isBuffer(cek)) {
    throw new Error('Buffers required for AES-GCM encryption');
  }
  if (cek.length !== 32) {
    throw new Error('CEK must be 32 bytes for AES-256-GCM');
  }
  const iv = generateIV();
  const cipher = crypto.createCipheriv(AES_ALGO, cek, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const pkg = Buffer.concat([iv, authTag, ciphertext]);
  return {
    package: pkg,
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
  };
}

/**
 * Decrypts a package produced by encryptAESGCM.
 * @param {Buffer} packageBuffer
 * @param {Buffer} cek
 * @returns {Buffer}
 */
function decryptAESGCM(packageBuffer, cek) {
  if (!Buffer.isBuffer(packageBuffer) || packageBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Malformed package buffer');
  }
  if (!Buffer.isBuffer(cek) || cek.length !== 32) {
    throw new Error('CEK must be 32 bytes for AES-256-GCM');
  }
  const iv = packageBuffer.subarray(0, IV_LENGTH);
  const authTag = packageBuffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packageBuffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(AES_ALGO, cek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Wraps the CEK with a recipient's RSA public key using RSA-OAEP + SHA-256.
 * NOTE: For production deployments prefer ECDH (e.g., X25519) + HKDF + AES-KW to enable forward secrecy and smaller keys.
 * @param {Buffer} cek
 * @param {string} recipientPubPem
 * @returns {Buffer}
 */
function wrapKeyRSA(cek, recipientPubPem) {
  return crypto.publicEncrypt(
    {
      key: recipientPubPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    cek,
  );
}

/**
 * Unwraps a CEK with the corresponding RSA private key.
 * In production, private keys should live in secure wallets/HSMs; server-side unwrap is demo-only.
 * @param {Buffer} wrapped
 * @param {string} recipientPrivPem
 * @returns {Buffer}
 */
function unwrapKeyRSA(wrapped, recipientPrivPem) {
  return crypto.privateDecrypt(
    {
      key: recipientPrivPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrapped,
  );
}

/**
 * Computes a SHA-256 hex digest for deterministic anchoring payloads.
 * @param {string|Buffer} input
 * @returns {string}
 */
function sha256hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ============================================================================
// X25519 ECDH + HKDF + AES-GCM Key Wrapping (Modern, Production-Ready)
// ============================================================================

/**
 * Generate an X25519 keypair for ECDH key agreement.
 * X25519 provides 128-bit security with 32-byte keys (vs RSA-4096 512-byte keys).
 * 
 * @returns {{ privateKey: Buffer, publicKey: Buffer }}
 */
function generateX25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  
  // Extract raw 32-byte keys from DER encoding
  // X25519 public key is last 32 bytes of SPKI
  // X25519 private key is last 32 bytes of PKCS8
  const pubRaw = publicKey.subarray(publicKey.length - 32);
  const privRaw = privateKey.subarray(privateKey.length - 32);
  
  return { privateKey: privRaw, publicKey: pubRaw };
}

/**
 * Wrap a CEK using X25519 ECDH + HKDF + AES-GCM.
 * 
 * Process:
 * 1. Generate ephemeral X25519 keypair
 * 2. Perform ECDH with recipient's public key
 * 3. Derive KEK (Key Encryption Key) using HKDF-SHA256
 * 4. Wrap CEK using AES-GCM (simplified KW alternative)
 * 
 * @param {Buffer} cek - 32-byte Content Encryption Key to wrap
 * @param {Buffer} recipientPublicKey - Recipient's X25519 public key (32 bytes)
 * @returns {{ wrappedKey: Buffer, ephemeralPublicKey: Buffer }}
 */
function wrapKeyX25519(cek, recipientPublicKey) {
  if (!Buffer.isBuffer(cek) || cek.length !== 32) {
    throw new Error('CEK must be 32-byte Buffer');
  }
  
  const recipientPubKey = Buffer.isBuffer(recipientPublicKey)
    ? recipientPublicKey
    : Buffer.from(recipientPublicKey);
  
  if (recipientPubKey.length !== 32) {
    throw new Error('Recipient public key must be 32 bytes');
  }

  // 1. Generate ephemeral keypair
  const ephemeral = generateX25519KeyPair();

  // 2. Create X25519 key objects for ECDH
  const ephemeralPrivateKeyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]),
      ephemeral.privateKey
    ]),
    format: 'der',
    type: 'pkcs8'
  });

  const recipientPublicKeyObject = crypto.createPublicKey({
    key: Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]),
      recipientPubKey
    ]),
    format: 'der',
    type: 'spki'
  });

  // 3. Perform ECDH to get shared secret
  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeralPrivateKeyObject,
    publicKey: recipientPublicKeyObject
  });

  // 4. Derive KEK using HKDF-SHA256
  const info = Buffer.from('cardano-healthcare-vault-kek-v1', 'utf8');
  const kek = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), info, 32);

  // 5. Wrap CEK using AES-256-GCM (acts as key wrapping)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const encrypted = Buffer.concat([cipher.update(cek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Package: iv || authTag || encrypted
  const wrappedKey = Buffer.concat([iv, authTag, encrypted]);

  return {
    wrappedKey,
    ephemeralPublicKey: ephemeral.publicKey
  };
}

/**
 * Unwrap a CEK using X25519 ECDH + HKDF + AES-GCM.
 * 
 * @param {Buffer} wrappedKey - Wrapped CEK from wrapKeyX25519 (iv || authTag || ciphertext)
 * @param {Buffer} ephemeralPublicKey - Ephemeral public key from wrapKeyX25519 (32 bytes)
 * @param {Buffer} recipientPrivateKey - Recipient's X25519 private key (32 bytes)
 * @returns {Buffer} - Unwrapped 32-byte CEK
 */
function unwrapKeyX25519(wrappedKey, ephemeralPublicKey, recipientPrivateKey) {
  if (!Buffer.isBuffer(wrappedKey)) {
    throw new Error('Wrapped key must be a Buffer');
  }

  if (!Buffer.isBuffer(ephemeralPublicKey) || ephemeralPublicKey.length !== 32) {
    throw new Error('Ephemeral public key must be 32-byte Buffer');
  }

  if (!Buffer.isBuffer(recipientPrivateKey) || recipientPrivateKey.length !== 32) {
    throw new Error('Recipient private key must be 32-byte Buffer');
  }

  const recipientPrivateKeyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]),
      recipientPrivateKey
    ]),
    format: 'der',
    type: 'pkcs8'
  });

  const ephemeralPublicKeyObject = crypto.createPublicKey({
    key: Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]),
      ephemeralPublicKey
    ]),
    format: 'der',
    type: 'spki'
  });

  const sharedSecret = crypto.diffieHellman({
    privateKey: recipientPrivateKeyObject,
    publicKey: ephemeralPublicKeyObject
  });

  const info = Buffer.from('cardano-healthcare-vault-kek-v1', 'utf8');
  const kek = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), info, 32);

  const iv = wrappedKey.subarray(0, 12);
  const authTag = wrappedKey.subarray(12, 28);
  const encrypted = wrappedKey.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted;
}

/**
 * Convert X25519 key to base64 for storage/transmission.
 * @param {Uint8Array|Buffer} key - X25519 key (32 bytes)
 * @returns {string} - Base64 encoded key
 */
function keyToBase64(key) {
  return Buffer.from(key).toString('base64');
}

/**
 * Convert base64 string to X25519 key.
 * @param {string} base64Key - Base64 encoded key
 * @returns {Buffer} - 32-byte key
 */
function keyFromBase64(base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid key length, expected 32 bytes');
  }
  return key;
}

/**
 * Load actor's public key from filesystem
 * @param {string} actorId - Actor ID ('01', '02', '03', '04')
 * @returns {Promise<string>} PEM-encoded public key
 */
async function loadActorPublicKey(actorId) {
  const fs = require('fs').promises;
  const path = require('path');
  
  const actorLabels = {
    '01': 'patient',
    '02': 'doctor',
    '03': 'hospital',
    '04': 'insurance'
  };
  
  const label = actorLabels[actorId];
  if (!label) {
    throw new Error(`Invalid actorId: ${actorId}`);
  }
  
  const pubKeyPath = path.join(__dirname, '..', '..', 'scripts', 'keys', `actor-${actorId}-${label}-pub.pem`);
  
  try {
    const pubKey = await fs.readFile(pubKeyPath, 'utf8');
    return pubKey;
  } catch (err) {
    throw new Error(`Failed to load public key for actor ${actorId}: ${err.message}`);
  }
}

module.exports = {
  // AES-GCM encryption
  generateCEK,
  generateIV,
  encryptAESGCM,
  decryptAESGCM,
  
  // RSA key wrapping (legacy, for backwards compatibility)
  wrapKeyRSA,
  unwrapKeyRSA,
  loadActorPublicKey,
  
  // X25519 key wrapping (modern, recommended)
  generateX25519KeyPair,
  wrapKeyX25519,
  unwrapKeyX25519,
  keyToBase64,
  keyFromBase64,
  
  // Utilities
  sha256hex,
  CONSTANTS: { AES_ALGO, IV_LENGTH, AUTH_TAG_LENGTH, X25519_KEY_LENGTH },
};
