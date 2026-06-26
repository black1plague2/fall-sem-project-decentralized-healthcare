#!/usr/bin/env node
/**
 * testAiken.js
 * Demonstrates Aiken smart contract integration functionality
 * 
 * This script tests:
 * 1. Loading compiled Plutus validator from plutus.json
 * 2. Reading validator hash
 * 3. Building permission datum structures
 * 4. Creating redeemers for all 5 actions
 * 5. Computing script address
 * 6. Displaying Aiken statistics
 * 
 * Prerequisites:
 * - contracts/build/plutus.json must exist (run: cd contracts && aiken compile)
 * - contracts/build/permission.hash must exist
 * - AIKEN_ENABLED=true in .env
 * 
 * Usage:
 *   node scripts/testAiken.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  loadValidator,
  getValidatorHash,
  buildPermissionDatum,
  buildGrantAccessRedeemer,
  buildRevokeAccessRedeemer,
  buildVerifyAccessRedeemer,
  buildUpdateExpirationRedeemer,
  buildBurnPermissionRedeemer,
  computeScriptAddress,
  getAikenStats
} = require('../src/services/aikenService');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(color, label, message) {
  console.log(`${color}[${label}]${colors.reset} ${message}`);
}

function logSection(title) {
  console.log(`\n${colors.cyan}${'='.repeat(60)}`);
  console.log(`${title}`);
  console.log(`${'='.repeat(60)}${colors.reset}\n`);
}

async function main() {
  console.log(`${colors.blue}
╔═══════════════════════════════════════════════════════════════╗
║                  Aiken Smart Contract Test                   ║
║           Testing Plutus V3 Validator Integration            ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  try {
    // Step 1: Check if Aiken is enabled
    logSection('Step 1: Check Aiken Configuration');
    const aikenEnabled = process.env.AIKEN_ENABLED === 'true';
    const aikenNetwork = process.env.AIKEN_NETWORK || 'preview';
    
    if (!aikenEnabled) {
      log(colors.red, 'ERROR', 'AIKEN_ENABLED=false in .env - Aiken integration is disabled');
      log(colors.yellow, 'FIX', 'Set AIKEN_ENABLED=true in .env to enable');
      process.exit(1);
    }
    
    log(colors.green, 'OK', `Aiken enabled on network: ${aikenNetwork}`);

    // Step 2: Load Plutus validator
    logSection('Step 2: Load Plutus Validator');
    const validator = loadValidator();
    
    if (!validator) {
      log(colors.red, 'ERROR', 'Failed to load validator from contracts/build/plutus.json');
      log(colors.yellow, 'FIX', 'Run: cd contracts && aiken compile');
      process.exit(1);
    }
    
    log(colors.green, 'OK', `Validator title: ${validator.preamble?.title || 'N/A'}`);
    log(colors.green, 'OK', `Validator version: ${validator.preamble?.version || 'N/A'}`);
    log(colors.green, 'OK', `Plutus version: ${validator.preamble?.plutusVersion || 'N/A'}`);
    
    // Check if validator has compiled code
    const validatorDef = validator.validators?.[0];
    if (validatorDef?.compiledCode) {
      const codeLength = validatorDef.compiledCode.length;
      log(colors.green, 'OK', `Compiled code length: ${codeLength} characters`);
    }

    // Step 3: Get validator hash
    logSection('Step 3: Get Validator Hash');
    const hash = getValidatorHash();
    
    if (!hash) {
      log(colors.red, 'ERROR', 'Failed to read validator hash from contracts/build/permission.hash');
      log(colors.yellow, 'FIX', 'Run: cd contracts && aiken compile && aiken hash');
      process.exit(1);
    }
    
    log(colors.green, 'OK', `Validator hash: ${hash}`);
    log(colors.blue, 'INFO', `Hash length: ${hash.length} characters`);

    // Step 4: Compute script address
    logSection('Step 4: Compute Script Address');
    const scriptAddr = computeScriptAddress(hash);
    
    if (!scriptAddr) {
      log(colors.red, 'ERROR', 'Failed to compute script address');
      process.exit(1);
    }
    
    log(colors.green, 'OK', `Script address: ${scriptAddr}`);
    log(colors.blue, 'INFO', 'This is the Cardano address where permission UTxOs will be stored');

    // Step 5: Build permission datum
    logSection('Step 5: Build Permission Datum');
    
    const testRecordId = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const testPermittedActors = ['02', '03']; // Doctor, Hospital
    const testOwner = '01'; // Patient
    const testExpiresAt = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1 year
    
    const datum = buildPermissionDatum(
      testRecordId,
      testPermittedActors,
      testOwner,
      testExpiresAt
    );
    
    log(colors.green, 'OK', 'Permission datum built successfully');
    log(colors.blue, 'DATUM', JSON.stringify({
      recordId: testRecordId.substring(0, 20) + '...',
      permittedActors: testPermittedActors,
      owner: testOwner,
      expiresAt: new Date(testExpiresAt * 1000).toISOString(),
      hasNftRef: !!datum.nft_ref
    }, null, 2));

    // Step 6: Build all redeemers
    logSection('Step 6: Build Redeemers (5 Actions)');
    
    // 6a: GrantAccess redeemer
    const grantRedeemer = buildGrantAccessRedeemer(['04'], 'mock-signature-01');
    log(colors.green, 'OK', 'GrantAccess redeemer built');
    log(colors.blue, 'INFO', `  → Adding actor: 04 (Insurance)`);
    
    // 6b: RevokeAccess redeemer
    const revokeRedeemer = buildRevokeAccessRedeemer(['02'], 'mock-signature-02');
    log(colors.green, 'OK', 'RevokeAccess redeemer built');
    log(colors.blue, 'INFO', `  → Removing actor: 02 (Doctor)`);
    
    // 6c: VerifyAccess redeemer
    const verifyRedeemer = buildVerifyAccessRedeemer('03');
    log(colors.green, 'OK', 'VerifyAccess redeemer built');
    log(colors.blue, 'INFO', `  → Checking access for: 03 (Hospital)`);
    
    // 6d: UpdateExpiration redeemer
    const newExpiration = Math.floor(Date.now() / 1000) + (180 * 24 * 60 * 60); // 6 months
    const updateRedeemer = buildUpdateExpirationRedeemer(newExpiration, 'mock-signature-03');
    log(colors.green, 'OK', 'UpdateExpiration redeemer built');
    log(colors.blue, 'INFO', `  → New expiration: ${new Date(newExpiration * 1000).toISOString()}`);
    
    // 6e: BurnPermission redeemer
    const burnRedeemer = buildBurnPermissionRedeemer('mock-signature-04');
    log(colors.green, 'OK', 'BurnPermission redeemer built');
    log(colors.blue, 'INFO', `  → Destroying permission record`);

    // Step 7: Display Aiken statistics
    logSection('Step 7: Aiken Service Statistics');
    const stats = getAikenStats();
    
    console.log(colors.cyan + JSON.stringify(stats, null, 2) + colors.reset);

    // Summary
    logSection('Test Summary');
    log(colors.green, 'SUCCESS', 'All Aiken integration tests passed! ✓');
    console.log();
    log(colors.blue, 'NEXT STEPS', 'To use Aiken in production:');
    console.log('  1. Install Aiken CLI: cargo install aiken');
    console.log('  2. Compile contracts: cd contracts && aiken compile');
    console.log('  3. Get validator hash: aiken hash');
    console.log('  4. Update AIKEN_VALIDATOR_HASH in .env');
    console.log('  5. Query script UTxOs via Blockfrost API');
    console.log('  6. Submit permission transactions using cardano-cli or Mesh SDK');
    console.log();

  } catch (error) {
    logSection('Test Failed');
    log(colors.red, 'ERROR', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
main().catch(err => {
  console.error(`${colors.red}Unhandled error:${colors.reset}`, err);
  process.exit(1);
});
