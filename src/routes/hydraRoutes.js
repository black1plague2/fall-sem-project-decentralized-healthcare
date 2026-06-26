// src/routes/hydraRoutes.js
// API routes for Hydra Layer-2 operations
// Provides HTTP interface to Hydra client and snapshot management

const express = require('express');
const router = express.Router();
const { getHydraClient } = require('../services/hydraClient');
const HydraSnapshot = require('../models/hydraSnapshotModel');
const { logger } = require('../services/auditLogger');

/**
 * GET /api/hydra/health
 * Check if Hydra node is reachable
 */
router.get('/health', async (req, res) => {
  try {
    const hydraClient = getHydraClient();
    const health = await hydraClient.health();
    
    logger.info('[Hydra] Health check', { status: health.ok });
    
    res.json({
      hydra: health,
      integration: {
        enabled: true,
        mockMode: process.env.HYDRA_RPC_BASE?.includes('localhost') || process.env.HYDRA_RPC_BASE?.includes('127.0.0.1'),
        baseUrl: process.env.HYDRA_RPC_BASE || 'http://localhost:4001'
      }
    });
    
  } catch (error) {
    logger.error('[Hydra] Health check failed', { error: error.message });
    res.status(503).json({
      error: 'Hydra node unreachable',
      message: error.message,
      details: 'Check if mock-hydra server is running or HYDRA_RPC_BASE is configured correctly'
    });
  }
});

/**
 * POST /api/hydra/heads
 * Create a new Hydra head
 * Body: { parties: [], contestationPeriod: 60 }
 * 
 * TODO: Add wallet signature verification for production
 * TODO: Real hydra-node requires on-chain TX (costs ADA)
 */
router.post('/heads', async (req, res) => {
  try {
    const { parties = [], contestationPeriod = 60 } = req.body;
    
    if (!Array.isArray(parties) || parties.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'parties array is required and must not be empty'
      });
    }
    
    const hydraClient = getHydraClient();
    const result = await hydraClient.createHead({ parties, contestationPeriod });
    
    logger.info('[Hydra] Head created', {
      headId: result.headId,
      parties: parties.length
    });
    
    res.status(201).json(result);
    
  } catch (error) {
    logger.error('[Hydra] Head creation failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to create Hydra head',
      message: error.message
    });
  }
});

/**
 * POST /api/hydra/propose
 * Propose an update to Hydra head and persist snapshot
 * Body: { headId, updatePayload }
 * 
 * TODO: Add rate limiting
 * TODO: Verify caller has permission to propose updates
 */
router.post('/propose', async (req, res) => {
  try {
    const { headId, updatePayload } = req.body;
    
    if (!headId || !updatePayload) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'headId and updatePayload are required'
      });
    }
    
    // Validate updatePayload structure
    if (!updatePayload.type || !updatePayload.recordId) {
      return res.status(400).json({
        error: 'Invalid updatePayload',
        message: 'updatePayload must contain type and recordId'
      });
    }
    
    const hydraClient = getHydraClient();
    const result = await hydraClient.proposeUpdate(headId, updatePayload);
    
    // Persist snapshot to MongoDB if accepted
    if (result.status === 'accepted') {
      const snapshot = await HydraSnapshot.createFromHydraResponse(result, headId);
      
      logger.info('[Hydra] Snapshot persisted', {
        headId,
        snapshotId: result.snapshotId,
        dbId: snapshot._id,
        recordsCount: snapshot.records.length
      });
      
      res.json({
        ...result,
        persisted: true,
        snapshotDbId: snapshot._id
      });
    } else {
      logger.warn('[Hydra] Update not accepted', {
        headId,
        status: result.status
      });
      
      res.status(409).json({
        error: 'Update not accepted',
        result
      });
    }
    
  } catch (error) {
    logger.error('[Hydra] Propose failed', { error: error.message });
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Head not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Failed to propose update',
      message: error.message
    });
  }
});

/**
 * GET /api/hydra/:headId/snapshot
 * Get latest snapshot for a head
 * Query params: ?source=hydra|db (default: db)
 */
router.get('/:headId/snapshot', async (req, res) => {
  try {
    const { headId } = req.params;
    const { source = 'db' } = req.query;
    
    if (source === 'hydra') {
      // Fetch directly from Hydra node
      const hydraClient = getHydraClient();
      const result = await hydraClient.getLatestSnapshot(headId);
      
      logger.info('[Hydra] Snapshot fetched from node', {
        headId,
        epoch: result.snapshot?.epoch
      });
      
      return res.json({
        source: 'hydra-node',
        ...result
      });
    }
    
    // Fetch from MongoDB (faster)
    const snapshot = await HydraSnapshot.getLatestForHead(headId);
    
    if (!snapshot) {
      return res.status(404).json({
        error: 'Snapshot not found',
        message: `No snapshots found for head ${headId}`,
        hint: 'Try ?source=hydra to query Hydra node directly'
      });
    }
    
    logger.info('[Hydra] Snapshot fetched from DB', {
      headId,
      snapshotId: snapshot.snapshotId,
      epoch: snapshot.epoch
    });
    
    res.json({
      source: 'database',
      ...snapshot.toSafeJSON()
    });
    
  } catch (error) {
    logger.error('[Hydra] Get snapshot failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to get snapshot',
      message: error.message
    });
  }
});

/**
 * GET /api/hydra/:headId/snapshots
 * Get snapshot history for a head
 * Query params: ?limit=50
 */
router.get('/:headId/snapshots', async (req, res) => {
  try {
    const { headId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const snapshots = await HydraSnapshot.getHistoryForHead(headId, limit);
    
    logger.info('[Hydra] Snapshot history fetched', {
      headId,
      count: snapshots.length
    });
    
    res.json({
      headId,
      snapshots: snapshots.map(s => s.toSafeJSON()),
      count: snapshots.length,
      limit
    });
    
  } catch (error) {
    logger.error('[Hydra] Get snapshots failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to get snapshots',
      message: error.message
    });
  }
});

/**
 * GET /api/hydra/records/:recordId/snapshot
 * Get latest snapshot containing a specific record
 */
router.get('/records/:recordId/snapshot', async (req, res) => {
  try {
    const { recordId } = req.params;
    
    const snapshot = await HydraSnapshot.getLatestForRecord(recordId);
    
    if (!snapshot) {
      return res.status(404).json({
        error: 'Snapshot not found',
        message: `No snapshots found containing record ${recordId}`
      });
    }
    
    // Extract the specific record data
    const record = snapshot.records.find(r => r.recordId === recordId);
    
    logger.info('[Hydra] Record snapshot fetched', {
      recordId,
      snapshotId: snapshot.snapshotId,
      epoch: snapshot.epoch
    });
    
    res.json({
      recordId,
      snapshot: snapshot.toSafeJSON(),
      record
    });
    
  } catch (error) {
    logger.error('[Hydra] Get record snapshot failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to get record snapshot',
      message: error.message
    });
  }
});

/**
 * POST /api/hydra/:headId/finalize
 * Close head and finalize to Cardano L1
 * Body: { reason?: string, signature? }
 * 
 * TODO: Require owner signature for production
 * TODO: Implement proper dispute window handling
 * TODO: Real hydra-node submits on-chain TX (costs ADA)
 */
router.post('/:headId/finalize', async (req, res) => {
  try {
    const { headId } = req.params;
    const { reason, signature } = req.body;
    
    // TODO: Verify signature in production
    // const isValid = await verifyWalletSignature(ownerAddr, signature, payload);
    // if (!isValid) return res.status(401).json({ error: 'Invalid signature' });
    
    const hydraClient = getHydraClient();
    const result = await hydraClient.finalizeToChain(headId, { reason });
    
    // Update all snapshots for this head as finalized
    await HydraSnapshot.updateMany(
      { headId, finalized: false },
      {
        $set: {
          finalized: true,
          txHash: result.txHash
        }
      }
    );
    
    logger.info('[Hydra] Head finalized', {
      headId,
      txHash: result.txHash,
      reason
    });
    
    res.json({
      ...result,
      snapshotsUpdated: true
    });
    
  } catch (error) {
    logger.error('[Hydra] Finalize failed', { error: error.message });
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Head not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Failed to finalize head',
      message: error.message
    });
  }
});

/**
 * GET /api/hydra/heads
 * List all heads (dev utility)
 */
router.get('/heads', async (req, res) => {
  try {
    const hydraClient = getHydraClient();
    const result = await hydraClient.listHeads();
    
    logger.info('[Hydra] Heads listed', { count: result.count });
    
    res.json(result);
    
  } catch (error) {
    logger.warn('[Hydra] List heads not supported', { error: error.message });
    
    // Fallback: query unique heads from DB
    const heads = await HydraSnapshot.distinct('headId');
    res.json({
      heads: heads.map(headId => ({ headId })),
      count: heads.length,
      source: 'database'
    });
  }
});

module.exports = router;
