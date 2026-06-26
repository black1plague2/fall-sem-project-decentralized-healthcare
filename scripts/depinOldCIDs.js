#!/usr/bin/env node
/**
 * depinOldCIDs.js
 * 
 * Safely unpin old IPFS CIDs from Pinata after CEK rotation or record deletion.
 * 
 * ⚠️  IMPORTANT: This permanently removes files from IPFS pinning service.
 *     Use with caution and ensure you have backups.
 * 
 * Features:
 * - Dry-run mode to preview actions without unpinning
 * - Batch processing with progress tracking
 * - Interactive confirmation prompts
 * - Detailed logging and error handling
 * - MongoDB record lookup support
 * 
 * Usage:
 *   node scripts/depinOldCIDs.js [options] <recordId|CID> [CID2] [CID3]...
 *   npm run depin -- [options] <recordId|CID> [CID2] [CID3]...
 * 
 * Options:
 *   --dry-run     Preview actions without actually unpinning
 *   --force       Skip confirmation prompt
 *   --verbose     Show detailed progress information
 *   --batch-size  Number of CIDs to process in parallel (default: 5)
 * 
 * Examples:
 *   # Dry-run to preview
 *   node scripts/depinOldCIDs.js --dry-run bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *   
 *   # Unpin with confirmation
 *   node scripts/depinOldCIDs.js record-uuid-here
 *   
 *   # Batch unpin without confirmation
 *   npm run depin -- --force cid1 cid2 cid3
 * 
 * Environment Variables:
 *   PINATA_KEY         - Pinata API key (required)
 *   PINATA_SECRET      - Pinata API secret (required)
 *   DB_URI             - MongoDB connection string (required for record lookup)
 *   MOCK_IPFS_UPLOAD   - If true, skip actual Pinata API calls
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const Record = require('../src/models/recordModel');
const auditLogger = require('../src/services/auditLogger');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const VERBOSE = args.includes('--verbose');
const BATCH_SIZE = parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 5;
const inputs = args.filter(arg => !arg.startsWith('--'));

// Environment configuration
const PINATA_KEY = process.env.PINATA_KEY;
const PINATA_SECRET = process.env.PINATA_SECRET;
const MOCK_MODE = process.env.MOCK_IPFS_UPLOAD === 'true';

/**
 * Unpin a CID from Pinata with enhanced error handling
 */
async function unpinFromPinata(cid) {
  // Skip actual unpinning in mock mode or dry-run
  if (MOCK_MODE || DRY_RUN) {
    log(`   🔵 Mock mode: Would unpin ${cid}`, 'verbose');
    return { success: true, mock: true };
  }
  
  if (!PINATA_KEY || !PINATA_SECRET) {
    throw new Error('PINATA_KEY and PINATA_SECRET environment variables required');
  }

  const url = `https://api.pinata.cloud/pinning/unpin/${cid}`;
  
  try {
    log(`   🔗 Calling Pinata API: DELETE ${url}`, 'verbose');
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'pinata_api_key': PINATA_KEY,
        'pinata_secret_api_key': PINATA_SECRET
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      
      // Handle common errors
      if (response.status === 404) {
        log(`   ⚠️  CID not found on Pinata (may already be unpinned): ${cid}`, 'warn');
        return { success: true, alreadyUnpinned: true };
      }
      
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication failed: Check PINATA_KEY and PINATA_SECRET`);
      }
      
      throw new Error(`Pinata API error: ${response.status} - ${errorText}`);
    }

    auditLogger.logger.info('[DepinScript] Successfully unpinned from Pinata', { cid });
    return { success: true };
  } catch (error) {
    auditLogger.logger.error('[DepinScript] Failed to unpin from Pinata', {
      cid,
      error: error.message
    });
    throw error;
  }
}

/**
 * Logging utility with level support
 */
function log(message, level = 'info') {
  if (level === 'verbose' && !VERBOSE) return;
  
  const timestamp = new Date().toISOString();
  const prefix = {
    verbose: '🔍',
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌'
  }[level] || 'ℹ️ ';
  
  console.log(`${prefix} ${message}`);
}

/**
 * Get CID from record ID
 */
async function getCIDFromRecord(recordId) {
  const record = await Record.findOne({ recordId });
  
  if (!record) {
    throw new Error(`Record not found: ${recordId}`);
  }

  if (!record.cid) {
    throw new Error(`Record ${recordId} has no CID`);
  }

  return record.cid;
}

/**
 * Validate CID format (basic check)
 */
function isCID(str) {
  return str && (str.startsWith('bafy') || str.startsWith('Qm'));
}

/**
 * Prompt user for confirmation (interactive mode)
 */
async function promptConfirmation(totalCIDs) {
  if (FORCE) {
    log('⚡ Force mode enabled - skipping confirmation', 'warn');
    return true;
  }
  
  if (DRY_RUN) {
    return true; // No confirmation needed for dry run
  }
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('\n⚠️  WARNING: You are about to permanently unpin CIDs from IPFS!');
    console.log(`   Total CIDs to unpin: ${totalCIDs}`);
    console.log('   This action CANNOT be undone!\n');
    
    readline.question('❓ Type "yes" to confirm or anything else to cancel: ', (answer) => {
      readline.close();
      resolve(answer.toLowerCase().trim() === 'yes');
    });
  });
}

/**
 * Process CIDs in batches with concurrency control
 */
async function processCIDsInBatch(cids) {
  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    details: []
  };

  // Process in batches to avoid overwhelming Pinata API
  for (let i = 0; i < cids.length; i += BATCH_SIZE) {
    const batch = cids.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cids.length / BATCH_SIZE);
    
    log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} CIDs)...`, 'verbose');

    const promises = batch.map(async (cidInfo) => {
      const { input, cid } = cidInfo;
      
      if (!isCID(cid)) {
        log(`⚠️  Invalid CID format: ${cid}`, 'warn');
        results.skipped++;
        results.details.push({ input, cid, status: 'invalid', reason: 'Invalid CID format' });
        return { input, cid, success: false, reason: 'Invalid format' };
      }

      try {
        const result = await unpinFromPinata(cid);
        
        if (result.alreadyUnpinned) {
          results.skipped++;
          results.details.push({ input, cid, status: 'already_unpinned' });
          log(`⚠️  Already unpinned: ${cid}`, 'verbose');
          return { input, cid, success: true, alreadyUnpinned: true };
        }
        
        if (result.mock || DRY_RUN) {
          log(`🔵 Would unpin: ${cid}`, 'verbose');
        } else {
          log(`✅ Unpinned: ${cid}`, 'verbose');
        }
        
        results.success++;
        results.details.push({ input, cid, status: 'success' });
        return { input, cid, success: true };
      } catch (error) {
        log(`❌ Failed: ${cid} - ${error.message}`, 'error');
        results.failed++;
        results.details.push({ input, cid, status: 'failed', reason: error.message });
        return { input, cid, success: false, reason: error.message };
      }
    });

    // Wait for batch to complete
    await Promise.allSettled(promises);
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < cids.length && !DRY_RUN && !MOCK_MODE) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Main de-pin logic with enhanced features
 */
async function depinCIDs(inputs) {
  const startTime = Date.now();
  
  // Header
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? '🔍 IPFS CID Depinning Script (DRY RUN)' : '🗑️  IPFS CID Depinning Script');
  console.log('═══════════════════════════════════════════════════════════════\n');

  log(`Mode: ${DRY_RUN ? 'DRY RUN' : MOCK_MODE ? 'MOCK' : 'LIVE'}`, 'info');
  log(`Batch size: ${BATCH_SIZE}`, 'verbose');
  log(`Force mode: ${FORCE ? 'YES' : 'NO'}`, 'verbose');
  log(`Verbose logging: ${VERBOSE ? 'YES' : 'NO'}\n`, 'verbose');

  // Validate inputs
  if (!inputs || inputs.length === 0) {
    console.error('❌ Error: No CIDs or record IDs provided\n');
    console.log('Usage: node scripts/depinOldCIDs.js [options] <recordId|CID> [CID2] [CID3]...');
    console.log('   or: npm run depin -- [options] <recordId|CID> [CID2] [CID3]...\n');
    console.log('Options:');
    console.log('  --dry-run      Preview actions without unpinning');
    console.log('  --force        Skip confirmation prompt');
    console.log('  --verbose      Show detailed progress');
    console.log('  --batch-size=N Process N CIDs in parallel (default: 5)\n');
    process.exit(1);
  }

  try {
    // Connect to MongoDB
    log('🔌 Connecting to MongoDB...', 'info');
    const dbUri = process.env.DB_URI || 'mongodb://localhost:27017/cardano-vault';
    await mongoose.connect(dbUri);
    log('✅ Connected to MongoDB\n', 'info');

    // Resolve inputs to CIDs
    log('🔍 Resolving inputs to CIDs...', 'info');
    const cidInfos = [];
    
    for (const [index, input] of inputs.entries()) {
      log(`   [${index + 1}/${inputs.length}] Processing input: ${input}`, 'verbose');
      
      try {
        let cid = input;

        // If input doesn't look like a CID, treat it as a record ID
        if (!isCID(input)) {
          log(`      📄 Looking up CID for record ID: ${input}`, 'verbose');
          cid = await getCIDFromRecord(input);
          log(`      ✅ Found CID: ${cid}`, 'verbose');
        } else {
          log(`      ✅ Direct CID input: ${cid}`, 'verbose');
        }

        cidInfos.push({ input, cid });
      } catch (error) {
        log(`      ❌ Failed to resolve: ${error.message}`, 'error');
        cidInfos.push({ input, cid: null, error: error.message });
      }
    }

    const validCIDs = cidInfos.filter(info => info.cid && !info.error);
    const invalidInputs = cidInfos.filter(info => info.error);

    log(`✅ Resolved ${validCIDs.length} valid CID(s)`, 'info');
    if (invalidInputs.length > 0) {
      log(`⚠️  Failed to resolve ${invalidInputs.length} input(s)`, 'warn');
    }

    if (validCIDs.length === 0) {
      log('\n❌ No valid CIDs to process. Exiting.', 'error');
      await mongoose.disconnect();
      process.exit(1);
    }

    // Show preview in dry-run mode
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN MODE - No actual changes will be made\n');
      console.log('📋 Preview of CIDs that would be unpinned:');
      validCIDs.forEach((info, i) => {
        console.log(`   ${i + 1}. ${info.cid}`);
        if (info.input !== info.cid) {
          console.log(`      (from input: ${info.input})`);
        }
      });
      
      if (invalidInputs.length > 0) {
        console.log('\n⚠️  Invalid inputs (would be skipped):');
        invalidInputs.forEach((info, i) => {
          console.log(`   ${i + 1}. ${info.input}`);
          console.log(`      Reason: ${info.error}`);
        });
      }

      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('� DRY RUN COMPLETE - No changes made');
      console.log(`   Valid CIDs found: ${validCIDs.length}`);
      console.log(`   Invalid inputs: ${invalidInputs.length}`);
      console.log('   Re-run without --dry-run to perform actual unpinning');
      console.log('═══════════════════════════════════════════════════════════════\n');
      
      await mongoose.disconnect();
      return;
    }

    // Interactive confirmation (unless --force)
    const confirmed = await promptConfirmation(validCIDs.length);
    if (!confirmed) {
      log('\n❌ Operation cancelled by user', 'warn');
      await mongoose.disconnect();
      return;
    }

    log('\n✅ Confirmed - Starting unpinning process...\n', 'info');

    // Process CIDs in batches
    const batchResults = await processCIDsInBatch(validCIDs);

    // Audit log successful operations
    batchResults.details
      .filter(d => d.status === 'success')
      .forEach(d => {
        auditLogger.logger.info('[DepinScript] CID unpinned', {
          input: d.input,
          cid: d.cid,
          timestamp: new Date().toISOString()
        });
      });

    // Audit log failures
    batchResults.details
      .filter(d => d.status === 'failed')
      .forEach(d => {
        auditLogger.logger.error('[DepinScript] Unpin failed', {
          input: d.input,
          cid: d.cid,
          error: d.reason,
          timestamp: new Date().toISOString()
        });
      });

    // Final summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 FINAL SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Mode:                     ${MOCK_MODE ? 'MOCK' : 'LIVE'}`);
    console.log(`Total inputs:             ${inputs.length}`);
    console.log(`Valid CIDs found:         ${validCIDs.length}`);
    console.log(`Invalid inputs:           ${invalidInputs.length}`);
    console.log(`  ✅ Successfully unpinned: ${batchResults.success}`);
    console.log(`  ❌ Failed:                ${batchResults.failed}`);
    console.log(`  ⚠️  Skipped:              ${batchResults.skipped}`);
    console.log(`Duration:                 ${duration}s`);
    console.log(`Batch size used:          ${BATCH_SIZE}`);

    // Show successful unpins
    if (batchResults.success > 0 && VERBOSE) {
      console.log('\n✅ Successfully unpinned:');
      batchResults.details
        .filter(d => d.status === 'success')
        .forEach(d => console.log(`   - ${d.cid}`));
    }

    // Show detailed failure report
    const failures = batchResults.details.filter(d => d.status === 'failed');
    if (failures.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('❌ FAILED CIDs (Detailed Report)');
      console.log('═══════════════════════════════════════════════════════════════');
      failures.forEach((item, i) => {
        console.log(`\n${i + 1}. CID: ${item.cid}`);
        console.log(`   Input: ${item.input}`);
        console.log(`   Reason: ${item.reason}`);
      });
    }

    // Show invalid inputs
    if (invalidInputs.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('⚠️  INVALID INPUTS (Could Not Resolve)');
      console.log('═══════════════════════════════════════════════════════════════');
      invalidInputs.forEach((item, i) => {
        console.log(`\n${i + 1}. Input: ${item.input}`);
        console.log(`   Reason: ${item.error}`);
      });
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    if (batchResults.failed === 0 && invalidInputs.length === 0) {
      console.log('✅ All CIDs successfully unpinned!');
    } else if (batchResults.failed > 0) {
      console.log(`⚠️  Completed with ${batchResults.failed} failure(s)`);
      console.log('   Review the failed CIDs above and retry if needed.');
    }
    console.log('═══════════════════════════════════════════════════════════════\n');

    await mongoose.disconnect();
    log('✅ Disconnected from MongoDB', 'verbose');

    // Exit with error code if any failures
    process.exit((batchResults.failed + invalidInputs.length) > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error.message);
    if (VERBOSE) {
      console.error(error.stack);
    }

    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // Ignore disconnect errors
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  // Show help if no arguments or --help flag
  if (inputs.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🗑️  IPFS CID Depinning Script - Help');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('Usage:');
    console.log('  node scripts/depinOldCIDs.js [options] <recordId|CID> [CID2] [CID3]...');
    console.log('  npm run depin -- [options] <recordId|CID> [CID2] [CID3]...\n');
    console.log('Options:');
    console.log('  --dry-run         Preview actions without actually unpinning');
    console.log('  --force           Skip confirmation prompt');
    console.log('  --verbose         Show detailed progress information');
    console.log('  --batch-size=N    Number of CIDs to process in parallel (default: 5)');
    console.log('  --help, -h        Show this help message\n');
    console.log('Examples:');
    console.log('  # Dry-run to preview');
    console.log('  node scripts/depinOldCIDs.js --dry-run bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi\n');
    console.log('  # Unpin with confirmation');
    console.log('  node scripts/depinOldCIDs.js record-uuid-here\n');
    console.log('  # Batch unpin without confirmation');
    console.log('  npm run depin -- --force cid1 cid2 cid3\n');
    console.log('  # Verbose mode with custom batch size');
    console.log('  node scripts/depinOldCIDs.js --verbose --batch-size=10 cid1 cid2\n');
    console.log('Environment Variables:');
    console.log('  PINATA_KEY         Pinata API key (required)');
    console.log('  PINATA_SECRET      Pinata API secret (required)');
    console.log('  DB_URI             MongoDB connection string (required for record lookup)');
    console.log('  MOCK_IPFS_UPLOAD   If true, skip actual Pinata API calls\n');
    console.log('⚠️  WARNING: This permanently removes files from IPFS pinning service.');
    console.log('             Use with caution and ensure you have backups.\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    process.exit(0);
  }

  // Execute depinning
  depinCIDs(inputs).catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    if (VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

module.exports = { depinCIDs, unpinFromPinata, isCID, getCIDFromRecord };
