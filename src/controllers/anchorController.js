const { v4: uuidv4, validate: uuidValidate, version: uuidVersion } = require('uuid');
const Record = require('../models/recordModel');
const cryptoService = require('../services/cryptoService');

const ACTOR_IDS = new Set(['01', '02', '03', '04']);

function validateRecordId(id) {
  return typeof id === 'string' && uuidValidate(id) && uuidVersion(id) === 4;
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

    // TODO: Verify onchainTxHash via Blockfrost or Lucid by querying the tx and checking metadata/datum
    // For demo, we accept any txHash and mark as anchored
    const projectId = process.env.BLOCKFROST_PROJECT_ID;
    if (projectId) {
      const baseUrl =
        process.env.CARDANO_NETWORK === 'mainnet'
          ? 'https://cardano-mainnet.blockfrost.io/api/v0'
          : 'https://cardano-testnet.blockfrost.io/api/v0';
      try {
        const response = await fetch(`${baseUrl}/txs/${onchainTxHash}`, {
          headers: { project_id: projectId },
        });
        if (!response.ok) {
          return res.status(400).json({ error: 'On-chain transaction not found or invalid' });
        }
        const txData = await response.json();
        console.info(`Verified tx ${onchainTxHash} on chain:`, txData.hash);
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

module.exports = { confirmAnchorHandler };
