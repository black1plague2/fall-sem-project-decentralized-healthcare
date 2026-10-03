// src/models/progressSessionModel.js
// Backing store for the live pipeline SSE stream. Previously an in-memory
// Map — broke as soon as the POST that emits events and the GET that
// streams them could land on two different serverless instances (which
// Vercel does not prevent). Storing events here means any instance can
// serve the SSE connection correctly by polling this collection.

const mongoose = require('mongoose');

const progressSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    // Each entry is the exact flat event object a caller passed to
    // sendUpdate() (already shaped as { step, status, ...extra }).
    events: [
      {
        payload: mongoose.Schema.Types.Mixed,
        timestamp: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    closed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// Sessions are short-lived (a single pipeline run) — auto-expire quickly
// so this collection never grows unbounded.
progressSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 30 });

module.exports = mongoose.models.ProgressSession || mongoose.model('ProgressSession', progressSessionSchema);
