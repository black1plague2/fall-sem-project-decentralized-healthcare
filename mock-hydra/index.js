// mock-hydra/index.js
// Mock Hydra Node API server for local development
// Simulates hydra-node responses without requiring real Cardano infrastructure
// TODO: Replace with real hydra-node connection for production

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.MOCK_HYDRA_PORT || 4001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory storage (simulates Hydra head state)
const heads = new Map(); // headId -> { status, snapshot, snapshots: [] }
let snapshotCounter = 0;

// Logger
const log = (msg, data = {}) => {
  console.log(`[Mock-Hydra] ${msg}`, data);
};

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'mock-hydra',
    version: '1.0.0',
    headsCount: heads.size,
    timestamp: Date.now()
  });
});

/**
 * POST /heads
 * Create a new Hydra head (simulates on-chain head initialization)
 * Body: { parties: [], contestationPeriod: 60 }
 * Returns: { headId, status }
 * 
 * TODO: Real hydra-node requires on-chain TX to open head (costs ADA)
 */
app.post('/heads', (req, res) => {
  try {
    const { parties = [], contestationPeriod = 60 } = req.body;
    
    // Generate mock head ID
    const headId = `head-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Initialize head state
    heads.set(headId, {
      headId,
      status: 'open',
      parties,
      contestationPeriod,
      snapshot: {
        epoch: 0,
        records: {},
        acceptedAt: Date.now()
      },
      snapshots: [],
      createdAt: Date.now()
    });
    
    log('Head created', { headId, parties: parties.length });
    
    res.status(201).json({
      headId,
      status: 'open',
      parties,
      contestationPeriod,
      message: 'Mock head created (no on-chain TX required in dev mode)'
    });
    
  } catch (error) {
    log('Error creating head', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /heads/:headId/propose
 * Propose an update to Hydra head (off-chain state update)
 * Body: { type, recordId, cidHash, wrappedKeys, author, timestamp }
 * Returns: { status, snapshotId, snapshot }
 * 
 * TODO: Real hydra-node requires multi-party signatures for snapshot confirmation
 */
app.post('/heads/:headId/propose', (req, res) => {
  try {
    const { headId } = req.params;
    const updatePayload = req.body;
    
    // Validate head exists
    const head = heads.get(headId);
    if (!head) {
      return res.status(404).json({ error: 'Head not found', headId });
    }
    
    if (head.status !== 'open') {
      return res.status(400).json({ error: 'Head is not open', status: head.status });
    }
    
    // Validate payload
    if (!updatePayload.type || !updatePayload.recordId) {
      return res.status(400).json({ error: 'Invalid update payload: type and recordId required' });
    }
    
    // Generate snapshot ID
    snapshotCounter++;
    const snapshotId = `snapshot-${headId}-${snapshotCounter}`;
    
    // Update head snapshot (simulate instant acceptance in mock)
    const newEpoch = head.snapshot.epoch + 1;
    
    // Merge update into current snapshot
    const currentRecords = head.snapshot.records || {};
    const updatedRecords = {
      ...currentRecords,
      [updatePayload.recordId]: {
        cidHash: updatePayload.cidHash,
        permittedActors: (updatePayload.wrappedKeys || []).map(wk => wk.actorId),
        wrappedKeys: updatePayload.wrappedKeys || [],
        author: updatePayload.author,
        lastUpdated: updatePayload.timestamp || Date.now()
      }
    };
    
    const newSnapshot = {
      epoch: newEpoch,
      snapshotId,
      records: updatedRecords,
      acceptedAt: Date.now(),
      updateType: updatePayload.type
    };
    
    // Save snapshot
    head.snapshot = newSnapshot;
    head.snapshots.push(newSnapshot);
    heads.set(headId, head);
    
    log('Update proposed and accepted', { 
      headId, 
      snapshotId, 
      epoch: newEpoch,
      recordId: updatePayload.recordId,
      actorsCount: (updatePayload.wrappedKeys || []).length
    });
    
    // TODO: Real hydra-node would require confirmation from all parties before accepting
    res.json({
      status: 'accepted',
      snapshotId,
      epoch: newEpoch,
      snapshot: newSnapshot,
      message: 'Mock instant acceptance (real hydra-node requires multi-sig)'
    });
    
  } catch (error) {
    log('Error proposing update', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /heads/:headId/snapshot
 * Get latest snapshot for a head
 * Returns: { headId, snapshot }
 */
app.get('/heads/:headId/snapshot', (req, res) => {
  try {
    const { headId } = req.params;
    
    const head = heads.get(headId);
    if (!head) {
      return res.status(404).json({ error: 'Head not found', headId });
    }
    
    res.json({
      headId,
      status: head.status,
      snapshot: head.snapshot,
      snapshotsCount: head.snapshots.length
    });
    
  } catch (error) {
    log('Error getting snapshot', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /heads/:headId/snapshots
 * Get all snapshots for a head (history)
 * Returns: { headId, snapshots: [] }
 */
app.get('/heads/:headId/snapshots', (req, res) => {
  try {
    const { headId } = req.params;
    
    const head = heads.get(headId);
    if (!head) {
      return res.status(404).json({ error: 'Head not found', headId });
    }
    
    res.json({
      headId,
      snapshots: head.snapshots,
      count: head.snapshots.length
    });
    
  } catch (error) {
    log('Error getting snapshots', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /heads/:headId/close
 * Close head and finalize to L1 (simulates on-chain finalization)
 * Body: { reason?: string }
 * Returns: { status, txHash, snapshot }
 * 
 * TODO: Real hydra-node requires on-chain TX to close head and finalize state
 */
app.post('/heads/:headId/close', (req, res) => {
  try {
    const { headId } = req.params;
    const { reason } = req.body;
    
    const head = heads.get(headId);
    if (!head) {
      return res.status(404).json({ error: 'Head not found', headId });
    }
    
    if (head.status !== 'open') {
      return res.status(400).json({ error: 'Head is not open', status: head.status });
    }
    
    // Update status
    head.status = 'closed';
    head.closedAt = Date.now();
    head.closeReason = reason;
    heads.set(headId, head);
    
    // Generate mock TX hash
    const txHash = `mock-tx-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    log('Head closed', { headId, txHash, reason });
    
    // TODO: Real hydra-node would submit finalization TX to Cardano and return real txHash
    res.json({
      status: 'closed',
      txHash,
      snapshot: head.snapshot,
      message: 'Mock close (no on-chain TX in dev mode)'
    });
    
  } catch (error) {
    log('Error closing head', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /heads
 * List all heads (dev utility)
 */
app.get('/heads', (req, res) => {
  const headsList = Array.from(heads.values()).map(h => ({
    headId: h.headId,
    status: h.status,
    epoch: h.snapshot.epoch,
    recordsCount: Object.keys(h.snapshot.records || {}).length,
    snapshotsCount: h.snapshots.length,
    createdAt: h.createdAt
  }));
  
  res.json({
    heads: headsList,
    count: headsList.length
  });
});

/**
 * DELETE /heads/:headId
 * Delete head (dev utility, not in real hydra-node API)
 */
app.delete('/heads/:headId', (req, res) => {
  const { headId } = req.params;
  
  if (heads.has(headId)) {
    heads.delete(headId);
    log('Head deleted', { headId });
    res.json({ message: 'Head deleted', headId });
  } else {
    res.status(404).json({ error: 'Head not found', headId });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /heads',
      'GET /heads',
      'POST /heads/:headId/propose',
      'GET /heads/:headId/snapshot',
      'GET /heads/:headId/snapshots',
      'POST /heads/:headId/close',
      'DELETE /heads/:headId'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║       Mock Hydra Node API Server v1.0.0        ║
╠════════════════════════════════════════════════╣
║  Port: ${PORT}                                    ║
║  Mode: Development (No real Cardano node)      ║
║  Endpoints:                                    ║
║    - GET  /health                              ║
║    - POST /heads                               ║
║    - POST /heads/:id/propose                   ║
║    - GET  /heads/:id/snapshot                  ║
║    - POST /heads/:id/close                     ║
╠════════════════════════════════════════════════╣
║  ⚠️  DEVELOPMENT ONLY - NOT FOR PRODUCTION     ║
║  TODO: Replace with real hydra-node for prod  ║
╚════════════════════════════════════════════════╝
  `);
  log('Server started', { port: PORT, pid: process.pid });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
