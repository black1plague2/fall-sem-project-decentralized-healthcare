#!/usr/bin/env node
/**
 * genActorX25519Keys.js
 * 
 * Generates X25519 (Curve25519) keypairs for actors in the Healthcare Vault system.
 * X25519 provides 128-bit security level with much smaller keys (32 bytes vs RSA-4096's 512 bytes).
 * 
 * ✅ RECOMMENDED for production (faster, smaller, modern cryptography)
 * ⚠️  Requires @noble/curves or equivalent X25519 implementation
 * 
 * Key Benefits:
 * - Faster key agreement (ECDH) vs RSA-OAEP
 * - Smaller key sizes (better for storage and transmission)
 * - Modern, audited cryptography (Curve25519)
 * - Browser-friendly (can unwrap on client-side)
 * 
 * Usage:
 *   node scripts/genActorX25519Keys.js [--force] [--verbose] [--test]
 * 
 * Options:
 *   --force     Overwrite existing keys without prompting
 *   --verbose   Show detailed generation process
 *   --test      Validate keys with test encryption/decryption
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import cryptoService for X25519 operations
let cryptoService;
try {
  cryptoService = require('../src/services/cryptoService');
  if (!cryptoService.generateX25519KeyPair) {
    throw new Error('cryptoService.generateX25519KeyPair not available');
  }
} catch (error) {
  console.error('❌ Failed to load cryptoService:', error.message);
  console.error('   Make sure @noble/curves is installed: npm install @noble/curves');
  process.exit(1);
}

// Actor definitions (must match backend actor IDs)
const ACTORS = [
  { id: '01', label: 'patient', description: 'Patient (Record Owner)' },
  { id: '02', label: 'doctor', description: 'Doctor (Healthcare Provider)' },
  { id: '03', label: 'hospital', description: 'Hospital (Healthcare Institution)' },
  { id: '04', label: 'insurance', description: 'Insurance (Coverage Provider)' },
];

const KEYS_DIR = path.join(__dirname, 'keys');
const KEY_SIZE = 32; // X25519 keys are always 32 bytes
const PRIV_KEY_PERMISSIONS = 0o600; // Read/write for owner only
const PUB_KEY_PERMISSIONS = 0o644;  // Readable by all, writable by owner

// Parse command line arguments
const args = process.argv.slice(2);
const FORCE_OVERWRITE = args.includes('--force');
const VERBOSE = args.includes('--verbose');
const TEST_KEYS = args.includes('--test');

/**
 * Ensure keys directory exists with secure permissions
 */
function ensureKeysDir() {
  try {
    if (!fs.existsSync(KEYS_DIR)) {
      fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
      log(`✅ Created directory: ${KEYS_DIR}`, 'info');
    } else {
      log(`ℹ️  Directory exists: ${KEYS_DIR}`, 'verbose');
    }
  } catch (error) {
    throw new Error(`Failed to create directory ${KEYS_DIR}: ${error.message}`);
  }
}

/**
 * Check if X25519 key files already exist for an actor
 */
function keysExist(actor) {
  const privPath = path.join(KEYS_DIR, `actor-${actor.id}-${actor.label}-x25519-priv.key`);
  const pubPath = path.join(KEYS_DIR, `actor-${actor.id}-${actor.label}-x25519-pub.key`);
  return fs.existsSync(privPath) || fs.existsSync(pubPath);
}

/**
 * Validate X25519 key pair by performing test key agreement
 */
async function validateKeyPair(privateKey, publicKey, actorLabel) {
  try {
    if (privateKey.length !== KEY_SIZE || publicKey.length !== KEY_SIZE) {
      throw new Error(`Invalid key size: private=${privateKey.length}, public=${publicKey.length}, expected=${KEY_SIZE}`);
    }
    
    // Test key agreement with another ephemeral key
    log(`   Testing key agreement...`, 'verbose');
    const { privateKey: ephPriv, publicKey: ephPub } = cryptoService.generateX25519KeyPair();
    
    // Derive shared secret from both sides
    const sharedSecret1 = cryptoService.deriveSharedSecret(privateKey, ephPub);
    const sharedSecret2 = cryptoService.deriveSharedSecret(ephPriv, publicKey);
    
    if (!sharedSecret1.equals(sharedSecret2)) {
      throw new Error('Key agreement test failed: shared secrets do not match');
    }
    
    // Test key wrapping/unwrapping if requested
    if (TEST_KEYS) {
      log(`   Testing CEK wrap/unwrap...`, 'verbose');
      const testCEK = crypto.randomBytes(32);
      const wrapped = await cryptoService.wrapCEK(testCEK, publicKey);
      const unwrapped = await cryptoService.unwrapCEK(wrapped, privateKey, ephPub);
      
      if (!testCEK.equals(unwrapped)) {
        throw new Error('Wrap/unwrap test failed: CEK mismatch');
      }
    }
    
    log(`   ✅ Key validation passed`, 'verbose');
    return true;
  } catch (error) {
    throw new Error(`Key validation failed for ${actorLabel}: ${error.message}`);
  }
}

/**
 * Generate X25519 key pair for a single actor
 */
async function generateKeyPair(actor) {
  const startTime = Date.now();
  
  try {
    log(`🔑 Generating X25519 key pair for ${actor.description}...`, 'info');
    
    // Check if keys already exist
    if (keysExist(actor) && !FORCE_OVERWRITE) {
      log(`⚠️  Keys already exist for actor ${actor.id}. Use --force to overwrite.`, 'warn');
      return false;
    }
    
    // Generate X25519 key pair
    log(`   Generating Curve25519 keys...`, 'verbose');
    const { privateKey, publicKey } = cryptoService.generateX25519KeyPair();
    
    // Validate generated keys
    log(`   Validating key pair...`, 'verbose');
    await validateKeyPair(privateKey, publicKey, actor.label);
    
    // Convert to base64 for storage
    const privKeyBase64 = cryptoService.keyToBase64(privateKey);
    const pubKeyBase64 = cryptoService.keyToBase64(publicKey);
    
    // Define file paths
    const privPath = path.join(KEYS_DIR, `actor-${actor.id}-${actor.label}-x25519-priv.key`);
    const pubPath = path.join(KEYS_DIR, `actor-${actor.id}-${actor.label}-x25519-pub.key`);
    
    // Write keys to files with secure permissions
    log(`   Writing private key...`, 'verbose');
    fs.writeFileSync(privPath, privKeyBase64, { mode: PRIV_KEY_PERMISSIONS });
    
    log(`   Writing public key...`, 'verbose');
    fs.writeFileSync(pubPath, pubKeyBase64, { mode: PUB_KEY_PERMISSIONS });
    
    // Verify file permissions (Unix-like systems)
    if (process.platform !== 'win32') {
      const privStats = fs.statSync(privPath);
      const privMode = privStats.mode & 0o777;
      if (privMode !== PRIV_KEY_PERMISSIONS) {
        log(`⚠️  Warning: Private key permissions are ${privMode.toString(8)}, expected ${PRIV_KEY_PERMISSIONS.toString(8)}`, 'warn');
      }
    }
    
    const duration = Date.now() - startTime;
    log(`✅ Generated X25519 keys for actor ${actor.id} (${actor.label}) in ${duration}ms`, 'success');
    log(`   Private: ${privPath}`, 'verbose');
    log(`   Public:  ${pubPath}`, 'verbose');
    log(`   Size:    ${KEY_SIZE} bytes (vs RSA-4096: 512 bytes)`, 'verbose');
    
    return true;
  } catch (error) {
    log(`❌ Failed to generate keys for actor ${actor.id}: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Generate X25519 keys for all actors
 */
async function generateAllX25519Keys() {
  console.log('\n🔐 X25519 Key Pair Generator for Cardano Healthcare Vault\n');
  console.log('━'.repeat(60));
  
  try {
    // Ensure keys directory exists
    ensureKeysDir();
    
    // Check for existing keys
    const existingKeys = ACTORS.filter(keysExist);
    if (existingKeys.length > 0 && !FORCE_OVERWRITE) {
      console.log(`\n⚠️  Found existing X25519 keys for ${existingKeys.length} actor(s):`);
      existingKeys.forEach(actor => {
        console.log(`   - Actor ${actor.id} (${actor.label})`);
      });
      console.log('\nRun with --force to overwrite existing keys.');
      console.log('━'.repeat(60));
      process.exit(0);
    }
    
    // Generate keys for each actor
    let successCount = 0;
    let failCount = 0;
    
    for (const actor of ACTORS) {
      try {
        if (await generateKeyPair(actor)) {
          successCount++;
        }
      } catch (error) {
        failCount++;
        log(`Skipping actor ${actor.id} due to error`, 'error');
      }
    }
    
    // Summary
    console.log('\n━'.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Successfully generated: ${successCount} key pair(s)`);
    if (failCount > 0) {
      console.log(`   ❌ Failed: ${failCount} key pair(s)`);
    }
    console.log(`   📁 Output directory: ${KEYS_DIR}`);
    console.log(`   📏 Key size: ${KEY_SIZE} bytes (X25519 standard)`);
    
    // Performance comparison
    console.log('\n📈 Performance Benefits (vs RSA-4096):');
    console.log(`   • Key size: ${KEY_SIZE} bytes (16x smaller)`);
    console.log('   • Key agreement: ~100x faster');
    console.log('   • Memory usage: ~10x lower');
    console.log('   • Browser-friendly: ✅ Client-side unwrap supported');
    
    // Security warnings
    console.log('\n⚠️  SECURITY WARNINGS:');
    console.log('   • NEVER commit private keys to version control');
    console.log('   • Keys are stored in scripts/keys/ (gitignored)');
    console.log('   • For production, use HSM/KMS for key management');
    console.log('   • Client-side unwrapping is strongly recommended');
    console.log('   • X25519 provides 128-bit security (post-quantum: consider ML-KEM)');
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Update actor records in database with public keys');
    console.log('   2. Test key wrapping with: npm run demo');
    console.log('   3. Verify browser unwrap with frontend integration');
    console.log('━'.repeat(60));
    console.log('');
    
    return successCount === ACTORS.length;
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.log('━'.repeat(60));
    console.log('');
    process.exit(1);
  }
}

/**
 * Logging utility with level support
 */
function log(message, level = 'info') {
  const levels = {
    verbose: VERBOSE,
    info: true,
    success: true,
    warn: true,
    error: true,
  };
  
  if (levels[level]) {
    console.log(message);
  }
}

// CLI execution
if (require.main === module) {
  generateAllX25519Keys()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error(`Fatal error: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { generateAllX25519Keys, generateKeyPair, ACTORS };
