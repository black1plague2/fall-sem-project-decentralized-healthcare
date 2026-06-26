/**
 * Browser-compatible unwrap helper (ES6 module)
 * 
 * This file provides client-side cryptographic operations for:
 * - X25519 ECDH shared secret derivation
 * - HKDF-SHA256 key derivation
 * - AES-256-GCM CEK unwrapping
 * - AES-256-GCM package decryption
 * 
 * Compatible with modern browsers supporting Web Crypto API.
 * 
 * IMPORTANT: This is a reference implementation using only Web Crypto API.
 * For production, consider using @noble/curves for X25519 operations.
 * 
 * Usage in browser:
 *   <script type="module" src="/utils/browserUnwrapHelper.js"></script>
 * 
 * Or with bundler:
 *   import { unwrapAndDecrypt } from './utils/browserUnwrapHelper.js';
 */

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError('hex must be a string');
  }
  if (hex.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string
 */
export function bytesToBase64(bytes) {
  const binaryString = String.fromCharCode(...bytes);
  return btoa(binaryString);
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive shared secret using X25519 ECDH
 * 
 * NOTE: Web Crypto API doesn't support X25519 natively in all browsers.
 * This is a placeholder. In production, use:
 *   import { x25519 } from '@noble/curves/ed25519';
 *   return x25519.getSharedSecret(privateKey, publicKey);
 * 
 * @param {Uint8Array} privateKey - 32-byte X25519 private key
 * @param {Uint8Array} publicKey - 32-byte X25519 public key
 * @returns {Promise<Uint8Array>} 32-byte shared secret
 */
export async function deriveSharedSecretX25519(privateKey, publicKey) {
  // Placeholder - requires @noble/curves in production
  throw new Error(
    'X25519 ECDH not implemented in Web Crypto API. ' +
    'Use @noble/curves: npm install @noble/curves'
  );
  
  /* Production code with @noble/curves:
  import { x25519 } from '@noble/curves/ed25519';
  return x25519.getSharedSecret(privateKey, publicKey);
  */
}

/**
 * Derive KEK from shared secret using HKDF-SHA256
 * 
 * @param {Uint8Array} sharedSecret - 32-byte shared secret
 * @param {string} info - Info string for HKDF context binding
 * @returns {Promise<Uint8Array>} 32-byte KEK
 */
export async function deriveKEK(sharedSecret, info = 'cardano-healthcare-vault-kek-v1') {
  // Import shared secret as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );
  
  // Derive KEK using HKDF
  const kekBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0), // Empty salt (as per server implementation)
      info: new TextEncoder().encode(info)
    },
    keyMaterial,
    256 // 32 bytes = 256 bits
  );
  
  return new Uint8Array(kekBits);
}

/**
 * Unwrap CEK using AES-256-GCM
 * 
 * @param {string} wrappedKeyBase64 - Base64-encoded wrapped key (iv||authTag||ciphertext)
 * @param {Uint8Array} kek - 32-byte KEK
 * @returns {Promise<Uint8Array>} 32-byte CEK
 */
export async function unwrapCEK(wrappedKeyBase64, kek) {
  // Decode wrapped key
  const wrappedKey = base64ToBytes(wrappedKeyBase64);
  
  // Parse: iv (12 bytes) || authTag (16 bytes) || ciphertext (32 bytes)
  if (wrappedKey.length !== 60) {
    throw new Error(`Invalid wrapped key length: ${wrappedKey.length}, expected 60`);
  }
  
  const iv = wrappedKey.slice(0, 12);
  const authTag = wrappedKey.slice(12, 28);
  const ciphertext = wrappedKey.slice(28);
  
  // Combine ciphertext + authTag for Web Crypto API
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  
  // Import KEK
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    kek,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const cek = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128
    },
    cryptoKey,
    combined
  );
  
  return new Uint8Array(cek);
}

/**
 * Decrypt package using AES-256-GCM
 * 
 * @param {string} encryptedPackageBase64 - Base64-encoded package (iv||authTag||ciphertext)
 * @param {Uint8Array} cek - 32-byte CEK
 * @returns {Promise<Uint8Array>} Plaintext data
 */
export async function decryptPackage(encryptedPackageBase64, cek) {
  // Decode package
  const encryptedPackage = base64ToBytes(encryptedPackageBase64);
  
  // Parse: iv (12 bytes) || authTag (16 bytes) || ciphertext
  if (encryptedPackage.length < 28) {
    throw new Error('Invalid encrypted package: too short');
  }
  
  const iv = encryptedPackage.slice(0, 12);
  const authTag = encryptedPackage.slice(12, 28);
  const ciphertext = encryptedPackage.slice(28);
  
  // Combine for Web Crypto API
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  
  // Import CEK
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128
    },
    cryptoKey,
    combined
  );
  
  return new Uint8Array(plaintext);
}

/**
 * Complete workflow: unwrap CEK and decrypt package
 * 
 * Production version should use @noble/curves for X25519:
 * 
 * @param {object} params - Decryption parameters
 * @param {string} params.wrappedKeyBase64 - Wrapped CEK from server
 * @param {string} params.ephemeralPublicKeyBase64 - Ephemeral public key from server
 * @param {string} params.actorPrivateKeyHex - Actor's X25519 private key (hex)
 * @param {string} params.encryptedPackageBase64 - Encrypted healthcare data
 * @returns {Promise<string>} Decrypted plaintext as UTF-8 string
 */
export async function unwrapAndDecrypt({
  wrappedKeyBase64,
  ephemeralPublicKeyBase64,
  actorPrivateKeyHex,
  encryptedPackageBase64
}) {
  // Note: This function requires @noble/curves for X25519 ECDH
  throw new Error(
    'Complete workflow requires @noble/curves. Install with: npm install @noble/curves\n' +
    'Then use:\n' +
    '  import { x25519 } from \'@noble/curves/ed25519\';\n' +
    '  const sharedSecret = x25519.getSharedSecret(privateKey, publicKey);'
  );
  
  /* Production implementation:
  
  // 1. Derive shared secret (X25519 ECDH)
  const actorPrivateKey = hexToBytes(actorPrivateKeyHex);
  const ephemeralPublicKey = base64ToBytes(ephemeralPublicKeyBase64);
  const sharedSecret = await deriveSharedSecretX25519(actorPrivateKey, ephemeralPublicKey);
  
  // 2. Derive KEK (HKDF)
  const kek = await deriveKEK(sharedSecret);
  
  // 3. Unwrap CEK (AES-GCM)
  const cek = await unwrapCEK(wrappedKeyBase64, kek);
  
  // 4. Decrypt package (AES-GCM)
  const plaintext = await decryptPackage(encryptedPackageBase64, cek);
  
  // 5. Zero out sensitive data
  cek.fill(0);
  kek.fill(0);
  sharedSecret.fill(0);
  actorPrivateKey.fill(0);
  
  // 6. Return plaintext as string
  return new TextDecoder().decode(plaintext);
  */
}

/**
 * Fetch encrypted record from API and decrypt client-side
 * 
 * @param {string} apiBaseUrl - API base URL (e.g., 'https://api.example.com')
 * @param {string} recordId - Record UUID
 * @param {string} actorId - Actor ID ('01', '02', '03', '04')
 * @param {string} actorPrivateKeyHex - Actor's private key (hex)
 * @param {string} actorSignature - Signed request (wallet or HMAC)
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function fetchAndDecryptRecord({
  apiBaseUrl,
  recordId,
  actorId,
  actorPrivateKeyHex,
  actorSignature
}) {
  // 1. Request access (get wrapped CEK)
  const accessResponse = await fetch(`${apiBaseUrl}/api/access/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordId,
      actorId,
      actorSignature
    })
  });
  
  if (!accessResponse.ok) {
    const error = await accessResponse.json();
    throw new Error(`Access denied: ${error.error}`);
  }
  
  const { cid, wrappedKeyBase64, ephemeralPublicKey } = await accessResponse.json();
  
  // 2. Download encrypted package from IPFS
  const ipfsGateway = 'https://gateway.pinata.cloud';
  const ipfsResponse = await fetch(`${ipfsGateway}/ipfs/${cid}`);
  
  if (!ipfsResponse.ok) {
    throw new Error(`Failed to download from IPFS: ${ipfsResponse.statusText}`);
  }
  
  const encryptedPackage = await ipfsResponse.arrayBuffer();
  const encryptedPackageBase64 = bytesToBase64(new Uint8Array(encryptedPackage));
  
  // 3. Decrypt
  return await unwrapAndDecrypt({
    wrappedKeyBase64,
    ephemeralPublicKeyBase64: ephemeralPublicKey,
    actorPrivateKeyHex,
    encryptedPackageBase64
  });
}

// Export all utilities
export default {
  hexToBytes,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  deriveSharedSecretX25519,
  deriveKEK,
  unwrapCEK,
  decryptPackage,
  unwrapAndDecrypt,
  fetchAndDecryptRecord
};
