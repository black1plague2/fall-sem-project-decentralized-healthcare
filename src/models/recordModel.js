const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema(
  {
    recordId: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    cid: { type: String },
    cidHash: { type: String },
    onchainTx: { type: String },
    wrappedKeys: {
      type: Map,
      of: String, // base64-encoded wrapped CEKs keyed by actorId
      default: {},
    },
    status: {
      type: String,
      enum: ['draft', 'pending_anchor', 'anchored', 'revoked', 'uploaded'],
      default: 'draft',
    },
    metadata: {
      patientId: { type: String },
      originalName: { type: String },
      mimeType: { type: String },
      size: { type: Number },
      encryptedSize: { type: Number },
      uploadedAt: { type: Date },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

recordSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    recordId: this.recordId,
    owner: this.owner,
    cid: this.cid,
    cidHash: this.cidHash,
    onchainTx: this.onchainTx,
    wrappedActors: Array.from(this.wrappedKeys.keys()),
    status: this.status,
    metadata: this.metadata || {},
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.models.Record || mongoose.model('Record', recordSchema);
