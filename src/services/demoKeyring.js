// src/services/demoKeyring.js
// Last-resort source of the demo actor keys, used only in DEMO_MODE when
// neither scripts/keys/ nor the DEMO_ACTOR_KEYS env var is available (e.g. a
// Vercel deploy built from GitHub, where the key files are gitignored).
//
// The first request that needs a key generates one key set for all four
// actors and stores it in MongoDB, so every serverless instance shares the
// same keys. Demo data only: real deployments keep private keys in a KMS or
// the user's wallet, never in the app database.

const crypto = require('crypto');
const mongoose = require('mongoose');

const KEYRING_ID = 'demo-actor-keys-v1';
const ACTORS = [
  ['01', 'patient'],
  ['02', 'doctor'],
  ['03', 'hospital'],
  ['04', 'insurance'],
];

const DemoKeyring = mongoose.models.DemoKeyring || mongoose.model('DemoKeyring', new mongoose.Schema({
  _id: String,
  files: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'demo_keyring' }));

let cached = null;
let pending = null;

function generateFiles() {
  const files = {};
  ACTORS.forEach(([id, label]) => {
    // RSA-2048 keeps first-request generation fast on serverless; the local
    // scripts use 4096. Same OAEP wrapping either way.
    const rsa = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    files[`actor-${id}-${label}-pub.pem`] = rsa.publicKey;
    files[`actor-${id}-${label}-priv.pem`] = rsa.privateKey;

    const x = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    files[`actor-${id}-${label}-x25519-pub.key`] = x.publicKey.subarray(x.publicKey.length - 32).toString('base64');
    files[`actor-${id}-${label}-x25519-priv.key`] = x.privateKey.subarray(x.privateKey.length - 32).toString('base64');
  });
  return files;
}

async function loadOrCreate() {
  const existing = await DemoKeyring.findById(KEYRING_ID).lean();
  if (existing) return existing.files;
  try {
    const doc = await DemoKeyring.create({ _id: KEYRING_ID, files: generateFiles() });
    return doc.files;
  } catch (err) {
    // Another instance created it first: use theirs so everyone agrees.
    if (err.code === 11000) return (await DemoKeyring.findById(KEYRING_ID).lean()).files;
    throw err;
  }
}

/**
 * @returns {Promise<Object<string,string>>} key file name -> contents
 */
async function getDemoKeyFiles() {
  if (cached) return cached;
  if (process.env.DEMO_MODE !== 'true') throw new Error('demo keyring is only available in DEMO_MODE');
  if (mongoose.connection.readyState !== 1) throw new Error('demo keyring needs a MongoDB connection');
  if (!pending) pending = loadOrCreate().finally(() => { pending = null; });
  cached = await pending;
  return cached;
}

/** Status for /api/config: whether a keyring exists, without touching it. */
async function keyringStatus() {
  // /api/config runs before the DB middleware, so a cold instance may not be
  // connected yet; the keyring is still used once a request connects.
  if (mongoose.connection.readyState !== 1) return { available: process.env.DEMO_MODE === 'true', created: null };
  const doc = await DemoKeyring.findById(KEYRING_ID, { createdAt: 1 }).lean().catch(() => null);
  return { available: process.env.DEMO_MODE === 'true', created: doc ? doc.createdAt : null };
}

module.exports = { getDemoKeyFiles, keyringStatus };
