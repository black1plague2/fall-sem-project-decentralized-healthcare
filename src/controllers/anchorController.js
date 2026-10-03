const { v4: uuidv4, validate: uuidValidate, version: uuidVersion } = require('uuid');
const Record = require('../models/recordModel');
const cryptoService = require('../services/cryptoService');

const ACTOR_IDS = new Set(['01', '02', '03', '04']);

function validateRecordId(id) {
  return typeof id === 'string' && uuidValidate(id) && uuidVersion(id) === 4;
}

// Blockfrost returns [{ label, json_metadata }]; the anchor payload may sit
// under any label and at any depth, so search every string value.
function metadataContains(value, needle) {
  if (!needle) return false;
  if (typeof value === 'string') return value === needle;
  if (Array.isArray(value)) return value.some((v) => metadataContains(v, needle));
  if (value && typeof value === 'object') return Object.values(value).some((v) => metadataContains(v, needle));
  return false;
}

async function confirmAnchorHandler(req, res, next) {
  try {
    const { recordId, onchainTxHash, signedPayload } = req.body;
    if (!validateRecordId(recordId)) {
      return res.status(422).json({ error: 'Invalid recordId format' });
    }
    if (!onchainTxHash) {
      return res.status(400).json({ error: 'onchainTxHash required' });
    }
    const record = await Record.findOne({ recordId });
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    if (record.status !== 'pending_anchor') {
      return res.status(400).json({ error: `Record status is ${record.status}, expected pending_anchor` });
    }

    // Verify onchainTxHash via Blockfrost: the tx must exist and its metadata
    // must carry this record's cidHash (from the anchorPayload returned by
    // pin-and-anchor). Without a Blockfrost key (demo mode) any txHash is accepted.
    const projectId = process.env.BLOCKFROST_PROJECT_ID;
    if (projectId) {
      // cardano-testnet.blockfrost.io doesn't exist — the legacy combined
      // testnet was retired in favor of preview/preprod. Preprod is what
      // BLOCKFROST_PROJECT_ID is provisioned for elsewhere in this app.
      const baseUrl =
        process.env.CARDANO_NETWORK === 'mainnet'
          ? 'https://cardano-mainnet.blockfrost.io/api/v0'
          : 'https://cardano-preprod.blockfrost.io/api/v0';
      try {
        const response = await fetch(`${baseUrl}/txs/${onchainTxHash}`, {
          headers: { project_id: projectId },
        });
        if (!response.ok) {
          return res.status(400).json({ error: 'On-chain transaction not found or invalid' });
        }
        const txData = await response.json();

        const metaResponse = await fetch(`${baseUrl}/txs/${onchainTxHash}/metadata`, {
          headers: { project_id: projectId },
        });
        const metadata = metaResponse.ok ? await metaResponse.json() : [];
        if (!metadataContains(metadata, record.cidHash)) {
          return res.status(400).json({
            error: 'Transaction metadata does not anchor this record',
            expectedCidHash: record.cidHash,
          });
        }
        console.info(`Verified tx ${onchainTxHash} on chain anchors record ${recordId}:`, txData.hash);
      } catch (err) {
        console.error('Blockfrost verification failed:', err.message);
        return res.status(503).json({ error: 'Unable to verify on-chain tx at this time' });
      }
    } else {
      console.warn('[confirm-anchor] BLOCKFROST_PROJECT_ID not set; accepting tx without on-chain verification (demo mode)');
    }

    record.onchainTx = onchainTxHash;
    record.status = 'anchored';
    await record.save();

    return res.status(200).json({
      recordId: record.recordId,
      status: record.status,
      onchainTx: record.onchainTx,
      message: 'Anchor confirmed successfully',
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { confirmAnchorHandler, metadataContains };
