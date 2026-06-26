// src/models/hydraSnapshotModel.js
// Mongoose model for persisting Hydra Head snapshots to MongoDB
// Stores off-chain state for fast permission lookups

const mongoose = require('mongoose');

const HydraSnapshotSchema = new mongoose.Schema({
  // Hydra Head identifier
  headId: {
    type: String,
    required: true,
    index: true
  },
  
  // Snapshot identifier (from Hydra node)
  snapshotId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Snapshot epoch (increments with each update)
  epoch: {
    type: Number,
    required: true,
    index: true
  },
  
  // Full snapshot data from Hydra node
  snapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  
  // Extracted records for faster querying
  // Array of { recordId, cidHash, permittedActors: [], wrappedKeys: [], author, lastUpdated }
  records: [{
    recordId: {
      type: String,
      required: true,
      index: true  // Critical: enables fast permission lookups
    },
    cidHash: String,
    permittedActors: [String],  // Array of actor IDs (e.g., ['01', '02'])
    wrappedKeys: [{
      actorId: String,
      wrappedKey: String,         // base64
      ephemeralPublicKey: String  // base64
    }],
    author: String,
    lastUpdated: Date
  }],
  
  // Signatures (multi-party confirmation)
  // TODO: Add signature verification for production Hydra
  signatures: [{
    party: String,      // Participant address
    signature: String,  // Ed25519 signature
    timestamp: Date
  }],
  
  // Status: 'pending' | 'accepted' | 'rejected'
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'accepted',
    index: true
  },
  
  // Timestamp when snapshot was accepted by Hydra
  acceptedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Timestamp when snapshot was persisted to DB
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // On-chain finalization (when head is closed)
  finalized: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Cardano TX hash (when finalized to L1)
  txHash: String,
  
  // Optional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'hydra_snapshots'
});

// Compound indexes for efficient queries
HydraSnapshotSchema.index({ headId: 1, epoch: -1 });  // Latest snapshot per head
HydraSnapshotSchema.index({ 'records.recordId': 1, createdAt: -1 });  // Latest snapshot for record
HydraSnapshotSchema.index({ headId: 1, status: 1, createdAt: -1 });  // Status filtering
HydraSnapshotSchema.index({ finalized: 1, createdAt: -1 });  // Finalized snapshots

// Instance methods

/**
 * Check if actor has permission for a record in this snapshot
 * @param {string} recordId - Record identifier
 * @param {string} actorId - Actor identifier (e.g., '01', '02')
 * @returns {boolean}
 */
HydraSnapshotSchema.methods.hasPermission = function(recordId, actorId) {
  const record = this.records.find(r => r.recordId === recordId);
  if (!record) return false;
  
  return record.permittedActors && record.permittedActors.includes(actorId);
};

/**
 * Get wrapped key for actor from this snapshot
 * @param {string} recordId - Record identifier
 * @param {string} actorId - Actor identifier
 * @returns {Object|null} - { wrappedKey, ephemeralPublicKey } or null
 */
HydraSnapshotSchema.methods.getWrappedKey = function(recordId, actorId) {
  const record = this.records.find(r => r.recordId === recordId);
  if (!record || !record.wrappedKeys) return null;
  
  const wrappedKeyEntry = record.wrappedKeys.find(wk => wk.actorId === actorId);
  return wrappedKeyEntry || null;
};

/**
 * Convert to safe JSON (hide sensitive data if needed)
 */
HydraSnapshotSchema.methods.toSafeJSON = function() {
  const obj = this.toObject();
  
  // Keep wrappedKeys but could hide in future if needed
  return {
    headId: obj.headId,
    snapshotId: obj.snapshotId,
    epoch: obj.epoch,
    recordsCount: obj.records?.length || 0,
    records: obj.records,
    status: obj.status,
    acceptedAt: obj.acceptedAt,
    finalized: obj.finalized,
    txHash: obj.txHash,
    createdAt: obj.createdAt
  };
};

// Static methods

/**
 * Get latest snapshot for a specific record
 * @param {string} recordId - Record identifier
 * @returns {Promise<HydraSnapshot|null>}
 */
HydraSnapshotSchema.statics.getLatestForRecord = async function(recordId) {
  return this.findOne({
    'records.recordId': recordId,
    status: 'accepted'
  })
  .sort({ createdAt: -1, epoch: -1 })
  .exec();
};

/**
 * Get latest snapshot for a head
 * @param {string} headId - Head identifier
 * @returns {Promise<HydraSnapshot|null>}
 */
HydraSnapshotSchema.statics.getLatestForHead = async function(headId) {
  return this.findOne({
    headId,
    status: 'accepted'
  })
  .sort({ epoch: -1, createdAt: -1 })
  .exec();
};

/**
 * Check if actor has permission in latest snapshot
 * @param {string} recordId - Record identifier
 * @param {string} actorId - Actor identifier
 * @returns {Promise<{granted: boolean, snapshot: HydraSnapshot|null}>}
 */
HydraSnapshotSchema.statics.checkPermission = async function(recordId, actorId) {
  const snapshot = await this.getLatestForRecord(recordId);
  
  if (!snapshot) {
    return { granted: false, snapshot: null };
  }
  
  const granted = snapshot.hasPermission(recordId, actorId);
  
  return { granted, snapshot };
};

/**
 * Get all snapshots for a head (history)
 * @param {string} headId - Head identifier
 * @param {number} limit - Max snapshots to return
 * @returns {Promise<HydraSnapshot[]>}
 */
HydraSnapshotSchema.statics.getHistoryForHead = async function(headId, limit = 50) {
  return this.find({ headId, status: 'accepted' })
    .sort({ epoch: -1, createdAt: -1 })
    .limit(limit)
    .exec();
};

/**
 * Create snapshot from Hydra node response
 * @param {Object} hydraResponse - Response from hydraClient.proposeUpdate
 * @param {string} headId - Head identifier
 * @returns {Promise<HydraSnapshot>}
 */
HydraSnapshotSchema.statics.createFromHydraResponse = async function(hydraResponse, headId) {
  const { snapshotId, snapshot, status, epoch } = hydraResponse;
  
  // Extract records array from snapshot.records object
  const recordsArray = [];
  if (snapshot && snapshot.records) {
    for (const [recordId, recordData] of Object.entries(snapshot.records)) {
      recordsArray.push({
        recordId,
        cidHash: recordData.cidHash,
        permittedActors: recordData.permittedActors || [],
        wrappedKeys: recordData.wrappedKeys || [],
        author: recordData.author,
        lastUpdated: recordData.lastUpdated ? new Date(recordData.lastUpdated) : new Date()
      });
    }
  }
  
  return this.create({
    headId,
    snapshotId,
    epoch: epoch || snapshot.epoch,
    snapshot,
    records: recordsArray,
    status: status === 'accepted' ? 'accepted' : 'pending',
    acceptedAt: snapshot.acceptedAt ? new Date(snapshot.acceptedAt) : new Date()
  });
};

const HydraSnapshot = mongoose.model('HydraSnapshot', HydraSnapshotSchema);

module.exports = HydraSnapshot;
