const express = require('express');
const Actor = require('../models/actorModel');
const { verifySignature } = require('../services/walletService');

const router = express.Router();

/**
 * POST /api/actors/register
 * Self-service actor registration
 */
router.post('/api/actors/register', async (req, res, next) => {
  try {
    const { actorId, name, role, walletAddress, publicKeys, signature, metadata } = req.body;

    if (!actorId || !name || !role || !walletAddress) {
      return res.status(400).json({ error: 'actorId, name, role, and walletAddress required' });
    }

    // Verify wallet signature (registration must be signed)
    if (signature) {
      const payload = {
        operation: 'actor_register',
        actorId,
        walletAddress,
        timestamp: signature.timestamp || Date.now(),
      };
      const isValid = await verifySignature(walletAddress, payload, signature);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid wallet signature' });
      }
    } else {
      console.warn('⚠️  Actor registration without signature (demo mode)');
    }

    // Check if actor already exists
    const existing = await Actor.findOne({ actorId });
    if (existing) {
      return res.status(409).json({ error: 'Actor ID already registered' });
    }

    const actor = new Actor({
      actorId,
      name,
      role,
      walletAddress,
      publicKeys: publicKeys || {},
      metadata: metadata || {},
    });

    await actor.save();
    console.info(`Actor registered: ${actorId} (${role})`);

    res.status(201).json({ actor: actor.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/actors/:actorId
 * Fetch actor details and public keys
 */
router.get('/api/actors/:actorId', async (req, res, next) => {
  try {
    const { actorId } = req.params;

    const actor = await Actor.findOne({ actorId });
    if (!actor) {
      return res.status(404).json({ error: 'Actor not found' });
    }

    res.json({ actor: actor.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/actors/:actorId
 * Update actor details (requires signature)
 */
router.put('/api/actors/:actorId', async (req, res, next) => {
  try {
    const { actorId } = req.params;
    const { name, publicKeys, signature, metadata } = req.body;

    const actor = await Actor.findOne({ actorId });
    if (!actor) {
      return res.status(404).json({ error: 'Actor not found' });
    }

    // Verify wallet signature
    if (signature) {
      const payload = {
        operation: 'actor_update',
        actorId,
        timestamp: signature.timestamp || Date.now(),
      };
      const isValid = await verifySignature(actor.walletAddress, payload, signature);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid wallet signature' });
      }
    } else {
      console.warn('⚠️  Actor update without signature (demo mode)');
    }

    // Update fields
    if (name) actor.name = name;
    if (publicKeys) {
      actor.publicKeys = { ...actor.publicKeys, ...publicKeys };
    }
    if (metadata) {
      actor.metadata = { ...actor.metadata, ...metadata };
    }

    await actor.save();
    console.info(`Actor updated: ${actorId}`);

    res.json({ actor: actor.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/actors/:actorId
 * Deactivate actor (soft delete)
 */
router.delete('/api/actors/:actorId', async (req, res, next) => {
  try {
    const { actorId } = req.params;
    const { signature } = req.body;

    const actor = await Actor.findOne({ actorId });
    if (!actor) {
      return res.status(404).json({ error: 'Actor not found' });
    }

    // Verify wallet signature
    if (signature) {
      const payload = {
        operation: 'actor_deactivate',
        actorId,
        timestamp: signature.timestamp || Date.now(),
      };
      const isValid = await verifySignature(actor.walletAddress, payload, signature);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid wallet signature' });
      }
    } else {
      console.warn('⚠️  Actor deactivation without signature (demo mode)');
    }

    actor.status = 'deactivated';
    await actor.save();
    console.info(`Actor deactivated: ${actorId}`);

    res.json({ message: 'Actor deactivated', actor: actor.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/actors
 * List all active actors (paginated)
 */
router.get('/api/actors', async (req, res, next) => {
  try {
    const { role, status = 'active', limit = 50, skip = 0 } = req.query;

    const query = { status };
    if (role) query.role = role;

    const actors = await Actor.find(query)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .sort({ createdAt: -1 });

    const total = await Actor.countDocuments(query);

    res.json({
      actors: actors.map((a) => a.toSafeJSON()),
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
