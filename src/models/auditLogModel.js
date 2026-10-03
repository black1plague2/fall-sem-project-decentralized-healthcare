// src/models/auditLogModel.js
// Audit trail storage in MongoDB — replaces reading Winston's local
// logs/audit.log file, which does not survive a serverless deployment
// (Vercel's filesystem is ephemeral and not shared across instances).
// Winston still writes to console + local files too (useful for local
// dev tailing), but /api/logs/view reads from here so it works anywhere.

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    // Free-form: recordId, actorId, result, method, rotationStatus,
    // requestId, walletAddr, reason — whatever logAudit() was called with.
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { versionKey: false },
);

// 90-day retention to mirror the HIPAA/GDPR-aligned retention already
// documented for the file-based logs.
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
