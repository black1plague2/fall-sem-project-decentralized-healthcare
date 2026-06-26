#!/usr/bin/env node
/**
 * genActorKeys.js
 * 
 * Generates RSA-4096 key pairs for demo actors (Patient, Doctor, Hospital, Insurance).
 * These keys are used for RSA-OAEP key wrapping in development/testing environments.
 * 
 * ⚠️  PRODUCTION WARNING:
 * - In production, use X25519 keys (see genActorX25519Keys.js)
 * - Store keys in secure HSM/KMS, not files
 * - Never commit private keys to version control
 * 
 * Usage:
 *   node scripts/genActorKeys.js [--force] [--verbose]
 * 
 * Options:
 *   --force     Overwrite existing keys without prompting
 *   --verbose   Show detailed generation process
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Actor definitions matching backend actor IDs
const ACTORS = [
  { id: '01', label: 'patient', description: 'Patient (Record Owner)' },
  { id: '02', label: 'doctor', description: 'Doctor (Healthcare Provider)' },
  { id: '03', label: 'hospital', description: 'Hospital (Healthcare Institution)' },
  { id: '04', label: 'insurance', description: 'Insurance (Coverage Provider)' },
];

const OUTPUT_DIR = path.join(__dirname, 'keys');
const KEY_SIZE = 4096; // RSA modulus length in bits
const KEY_PERMISSIONS = 0o600; // Read/write for owner only

// Parse command line arguments
const args = process.argv.slice(2);
const FORCE_OVERWRITE = args.includes('--force');
const VERBOSE = args.includes('--verbose');

/**
 * Ensure output directory exists with secure permissions
 */
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      log(`✅ Created directory: ${dir}`, 'info');
    } else {
      log(`ℹ️  Directory exists: ${dir}`, 'verbose');
    }
  } catch (error) {
    throw new Error(`Failed to create directory ${dir}: ${error.message}`);
  }
}

/**
 * Check if key files already exist for an actor
 */
function keysExist(actor) {
  const pubPath = path.join(OUTPUT_DIR, `actor-${actor.id}-${actor.label}-pub.pem`);
  const privPath = path.join(OUTPUT_DIR, `actor-${actor.id}-${actor.label}-priv.pem`);
  return fs.existsSync(pubPath) || fs.existsSync(privPath);
}

/**
 * Validate generated key pair
 */
function validateKeyPair(publicKey, privateKey) {
  try {
    // Test encryption/decryption roundtrip
    const testData = Buffer.from('test-validation-data');
    const encrypted = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      testData
    );
    const decrypted = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      encrypted
    );
    
    if (!testData.equals(decrypted)) {
      throw new Error('Key validation failed: decryption mismatch');
    }
    
    return true;
  } catch (error) {
    throw new Error(`Key validation failed: ${error.message}`);
  }
}

/**
 * Generate RSA key pair for a single actor
 */
function generateKeyPair(actor) {
  const startTime = Date.now();
  
  try {
    log(`🔑 Generating ${KEY_SIZE}-bit RSA key pair for ${actor.description}...`, 'info');
    
    // Check if keys already exist
    if (keysExist(actor) && !FORCE_OVERWRITE) {
      log(`⚠️  Keys already exist for actor ${actor.id}. Use --force to overwrite.`, 'warn');
      return false;
    }
    
    // Generate RSA key pair
    log(`   Generating prime numbers...`, 'verbose');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: KEY_SIZE,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    
    // Validate generated keys
    log(`   Validating key pair...`, 'verbose');
    validateKeyPair(publicKey, privateKey);
    
    // Write keys to files with secure permissions
    const pubPath = path.join(OUTPUT_DIR, `actor-${actor.id}-${actor.label}-pub.pem`);
    const privPath = path.join(OUTPUT_DIR, `actor-${actor.id}-${actor.label}-priv.pem`);
    
    log(`   Writing public key...`, 'verbose');
    fs.writeFileSync(pubPath, publicKey, { mode: KEY_PERMISSIONS });
    
    log(`   Writing private key...`, 'verbose');
    fs.writeFileSync(privPath, privateKey, { mode: KEY_PERMISSIONS });
    
    // Verify file permissions (Unix-like systems)
    if (process.platform !== 'win32') {
      const stats = fs.statSync(privPath);
      const mode = stats.mode & 0o777;
      if (mode !== KEY_PERMISSIONS) {
        log(`⚠️  Warning: Private key permissions are ${mode.toString(8)}, expected ${KEY_PERMISSIONS.toString(8)}`, 'warn');
      }
    }
    
    const duration = Date.now() - startTime;
    log(`✅ Generated keys for actor ${actor.id} (${actor.label}) in ${duration}ms`, 'success');
    log(`   Public:  ${pubPath}`, 'verbose');
    log(`   Private: ${privPath}`, 'verbose');
    
    return true;
  } catch (error) {
    log(`❌ Failed to generate keys for actor ${actor.id}: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Generate keys for all actors
 */
function generateAllKeys() {
  console.log('\n🔐 RSA Key Pair Generator for Cardano Healthcare Vault\n');
  console.log('━'.repeat(60));
  
  try {
    // Ensure output directory exists
    ensureDir(OUTPUT_DIR);
    
    // Check for existing keys
    const existingKeys = ACTORS.filter(keysExist);
    if (existingKeys.length > 0 && !FORCE_OVERWRITE) {
      console.log(`\n⚠️  Found existing keys for ${existingKeys.length} actor(s):`);
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
    
    ACTORS.forEach(actor => {
      try {
        if (generateKeyPair(actor)) {
          successCount++;
        }
      } catch (error) {
        failCount++;
        log(`Skipping actor ${actor.id} due to error`, 'error');
      }
    });
    
    // Summary
    console.log('\n━'.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Successfully generated: ${successCount} key pair(s)`);
    if (failCount > 0) {
      console.log(`   ❌ Failed: ${failCount} key pair(s)`);
    }
    console.log(`   📁 Output directory: ${OUTPUT_DIR}`);
    
    // Security warnings
    console.log('\n⚠️  SECURITY WARNINGS:');
    console.log('   • NEVER commit private keys to version control');
    console.log('   • Keys are stored in scripts/keys/ (gitignored)');
    console.log('   • For production, use HSM/KMS for key management');
    console.log('   • Consider using X25519 keys for better performance');
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
  try {
    const success = generateAllKeys();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { generateAllKeys, generateKeyPair, ACTORS };
