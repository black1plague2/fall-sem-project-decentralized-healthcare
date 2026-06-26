const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema(
  {
    actorId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['patient', 'doctor', 'hospital', 'insurance', 'other'],
      required: true,
    },
    walletAddress: {
      type: String,
      required: true,
      unique: true,
    },
    publicKeys: {
      rsa: {
        type: String, // PEM format
        required: false,
      },
      x25519: {
        type: String, // Hex format
        required: false,
      },
    },
    status: {
      type: String,
      enum: ['active', 'deactivated', 'suspended'],
      default: 'active',
    },
    metadata: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { timestamps: true }
);

// Only active actors
actorSchema.index({ status: 1 });

actorSchema.methods.toSafeJSON = function () {
  return {
    actorId: this.actorId,
    name: this.name,
    role: this.role,
    walletAddress: this.walletAddress,
    publicKeys: this.publicKeys,
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Actor', actorSchema);
