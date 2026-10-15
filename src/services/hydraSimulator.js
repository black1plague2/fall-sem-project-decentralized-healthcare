// src/services/hydraSimulator.js
// In-process Hydra head simulator.
//
// Used when no hydra-node (or the mock-hydra dev server) is reachable — for
// example on Vercel, where nothing listens on localhost:4001. It speaks the
// same response shapes as mock-hydra/index.js, so HydraClient can fall back
// to it transparently and the L2 layer keeps working end to end.
//
// What is simulated vs real here:
//   - Head state, epochs and consensus delay are simulated.
//   - The background "network traffic" is synthetic (made-up patients and
//     records, flagged synthetic: true) so the head looks alive in a demo.
//   - Every snapshot IS signed by each party with a real Ed25519 key and the
//     signatures are really verified when the head status is read.

const crypto = require('crypto');

const DEFAULT_HEAD_ID = 'head-sim-cardano-vault';

const PARTIES = [
  { id: '01', name: 'Patient' },
  { id: '02', name: 'Doctor' },
  { id: '03', name: 'Hospital' },
  { id: '04', name: 'Insurance' },
];

// One Ed25519 key pair per party, generated once per process.
const partyKeys = new Map(
  PARTIES.map((p) => [p.id, crypto.generateKeyPairSync('ed25519')])
);

function partyPublicKeyHex(partyId) {
  const der = partyKeys.get(partyId).publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('hex'); // raw 32-byte key
}

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------
const SYNTHETIC_PATIENTS = [
  'PT-1042', 'PT-1187', 'PT-2203', 'PT-2291', 'PT-3310', 'PT-3478', 'PT-4021', 'PT-4566',
];
const SYNTHETIC_DOCS = [
  'CBC blood panel', 'Chest X-ray report', 'MRI brain scan', 'Discharge summary',
  'HbA1c lab result', 'ECG trace', 'Vaccination record', 'Prescription history',
  'Lipid profile', 'Insurance claim #A-77',
];
const UPDATE_TYPES = ['SHARE_RECORD', 'SHARE_RECORD', 'SHARE_RECORD', 'GRANT_ACTOR', 'REVOKE_ACTOR'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }
function jitter(min, max) { return min + Math.random() * (max - min); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function syntheticActors() {
  const actors = ['01'];
  ['02', '03', '04'].forEach((id) => { if (Math.random() < 0.55) actors.push(id); });
  if (actors.length === 1) actors.push('02');
  return actors;
}

function syntheticUpdate() {
  const actors = syntheticActors();
  return {
    type: pick(UPDATE_TYPES),
    recordId: `syn-${randHex(4)}`,
    cidHash: randHex(32),
    wrappedKeys: actors.map((actorId) => ({ actorId, wrappedKey: 'synthetic', ephemeralPublicKey: 'synthetic' })),
    author: 'addr_test1_synthetic_' + randHex(6),
    timestamp: Date.now(),
    synthetic: true,
    label: `${pick(SYNTHETIC_PATIENTS)} · ${pick(SYNTHETIC_DOCS)}`,
  };
}

// ---------------------------------------------------------------------------
// Head state
// ---------------------------------------------------------------------------
const heads = new Map();
let snapshotCounter = 0;
const MAX_SYNTHETIC_RECORDS = 24;
const MAX_HISTORY = 200;

function newHead(headId, parties, contestationPeriod) {
  const head = {
    headId,
    status: 'open',
    parties,
    contestationPeriod,
    snapshot: { epoch: 0, records: {}, acceptedAt: Date.now() },
    snapshots: [],
    createdAt: Date.now(),
    lastSyntheticTick: Date.now(),
    totalTx: 0,
  };
  heads.set(headId, head);
  return head;
}

function snapshotDigest(headId, epoch, records) {
  const canonical = JSON.stringify({
    headId,
    epoch,
    records: Object.keys(records).sort().map((id) => [id, records[id].cidHash, records[id].permittedActors]),
  });
  return crypto.createHash('sha256').update(canonical).digest();
}

function signSnapshot(head, epoch, records) {
  const digest = snapshotDigest(head.headId, epoch, records);
  const signatures = PARTIES.map((p) => ({
    party: p.id,
    signature: crypto.sign(null, digest, partyKeys.get(p.id).privateKey).toString('hex'),
  }));
  return { digest: digest.toString('hex'), signatures };
}

function verifySnapshot(headId, snap) {
  if (!snap.signatures || !snap.signatures.length) return false;
  const digest = snapshotDigest(headId, snap.epoch, snap.records);
  if (digest.toString('hex') !== snap.digest) return false;
  return snap.signatures.every((s) =>
    crypto.verify(null, digest, partyKeys.get(s.party).publicKey, Buffer.from(s.signature, 'hex'))
  );
}

// Applies an update to the head and returns the new snapshot. Shared by
// real proposals (from the app) and synthetic background traffic.
function applyUpdate(head, update, confirmMs) {
  snapshotCounter += 1;
  const epoch = head.snapshot.epoch + 1;
  const snapshotId = `snapshot-${head.headId}-${snapshotCounter}`;
  const records = { ...(head.snapshot.records || {}) };

  records[update.recordId] = {
    cidHash: update.cidHash,
    permittedActors: (update.wrappedKeys || []).map((wk) => wk.actorId),
    wrappedKeys: update.wrappedKeys || [],
    author: update.author,
    lastUpdated: update.timestamp || Date.now(),
    ...(update.synthetic ? { synthetic: true, label: update.label } : {}),
  };

  // Keep synthetic records bounded so the snapshot doesn't grow forever.
  const syntheticIds = Object.keys(records).filter((id) => records[id].synthetic);
  while (syntheticIds.length > MAX_SYNTHETIC_RECORDS) delete records[syntheticIds.shift()];

  const { digest, signatures } = signSnapshot(head, epoch, records);
  const snapshot = {
    epoch,
    snapshotId,
    records,
    acceptedAt: Date.now(),
    updateType: update.type,
    recordId: update.recordId,
    synthetic: !!update.synthetic,
    label: update.label || null,
    confirmMs: Math.round(confirmMs * 10) / 10,
    digest,
    signatures,
  };

  head.snapshot = snapshot;
  head.snapshots.push(snapshot);
  if (head.snapshots.length > MAX_HISTORY) head.snapshots.shift();
  head.totalTx += 1;
  return snapshot;
}

// Synthetic traffic is generated lazily on read (no timers), so it works on
// serverless where a background interval wouldn't survive between requests.
function tickSyntheticTraffic(head) {
  if (head.status !== 'open') return;
  const now = Date.now();
  const elapsed = now - head.lastSyntheticTick;
  const due = Math.min(6, Math.floor(elapsed / 2500));
  for (let i = 0; i < due; i += 1) applyUpdate(head, syntheticUpdate(), jitter(3, 11));
  if (due > 0) head.lastSyntheticTick = now;
}

function seedHead(headId) {
  const head = newHead(headId, PARTIES.map((p) => p.id), 60);
  for (let i = 0; i < 14; i += 1) applyUpdate(head, syntheticUpdate(), jitter(3, 11));
  // Spread the seeded history over the last ~10 minutes so it reads naturally.
  const n = head.snapshots.length;
  head.snapshots.forEach((s, i) => { s.acceptedAt = Date.now() - (n - i) * 42000; });
  head.lastSyntheticTick = Date.now();
  return head;
}

function getHead(headId) {
  let head = heads.get(headId);
  // Serverless instances don't share memory: if a request lands on an
  // instance that hasn't seen this head yet, recreate it with seed data.
  if (!head) head = seedHead(headId);
  return head;
}

// ---------------------------------------------------------------------------
// API — same shapes as mock-hydra/index.js
// ---------------------------------------------------------------------------
async function health() {
  return { ok: true, service: 'hydra-simulator', version: '1.0.0', headsCount: heads.size, timestamp: Date.now() };
}

async function createHead({ parties = [], contestationPeriod = 60 } = {}) {
  const headId = `head-sim-${Date.now()}-${randHex(3)}`;
  newHead(headId, parties, contestationPeriod);
  return { headId, status: 'open', parties, contestationPeriod, message: 'Simulated head (in-process, no on-chain TX)' };
}

async function proposeUpdate(headId, update) {
  if (!update || !update.type || !update.recordId) {
    throw new Error('Invalid update proposal: type and recordId required');
  }
  const head = getHead(headId);
  if (head.status !== 'open') throw new Error('Cannot propose: head is not open');

  // Simulated multi-party consensus round (sign + broadcast + ack).
  const confirmMs = jitter(4, 14);
  await sleep(confirmMs);
  const snapshot = applyUpdate(head, update, confirmMs);
  return {
    status: 'accepted',
    snapshotId: snapshot.snapshotId,
    epoch: snapshot.epoch,
    snapshot,
    message: 'Accepted by simulated Hydra head (4/4 Ed25519 signatures)',
  };
}

async function getLatestSnapshot(headId) {
  const head = getHead(headId);
  tickSyntheticTraffic(head);
  return { headId, status: head.status, snapshot: head.snapshot, snapshotsCount: head.snapshots.length };
}

async function getSnapshots(headId) {
  const head = getHead(headId);
  tickSyntheticTraffic(head);
  return { headId, snapshots: head.snapshots, count: head.snapshots.length };
}

async function finalizeToChain(headId, { reason } = {}) {
  const head = getHead(headId);
  if (head.status !== 'open') throw new Error('Cannot close head: head is not open');
  head.status = 'closed';
  head.closedAt = Date.now();
  head.closeReason = reason;
  return { status: 'closed', txHash: `sim-tx-${randHex(16)}`, snapshot: head.snapshot, message: 'Simulated close (no on-chain TX)' };
}

async function listHeads() {
  const list = Array.from(heads.values()).map((h) => ({
    headId: h.headId,
    status: h.status,
    epoch: h.snapshot.epoch,
    recordsCount: Object.keys(h.snapshot.records || {}).length,
    snapshotsCount: h.snapshots.length,
    createdAt: h.createdAt,
  }));
  return { heads: list, count: list.length };
}

// Rich view of a head for the dashboard's Hydra panel.
function getHeadStatus(headId = DEFAULT_HEAD_ID, { limit = 12 } = {}) {
  const head = getHead(headId);
  tickSyntheticTraffic(head);

  const records = head.snapshot.records || {};
  const recordIds = Object.keys(records);
  const recent = head.snapshots.slice(-limit).reverse();
  const confirmTimes = head.snapshots.slice(-50).map((s) => s.confirmMs).filter((n) => typeof n === 'number');
  const windowStart = Date.now() - 60000;
  const lastMinute = head.snapshots.filter((s) => s.acceptedAt >= windowStart).length;

  return {
    headId: head.headId,
    status: head.status,
    contestationPeriod: head.contestationPeriod,
    createdAt: head.createdAt,
    epoch: head.snapshot.epoch,
    parties: PARTIES.map((p) => ({ ...p, publicKey: partyPublicKeyHex(p.id) })),
    totals: {
      snapshots: head.totalTx,
      records: recordIds.length,
      realRecords: recordIds.filter((id) => !records[id].synthetic).length,
      syntheticRecords: recordIds.filter((id) => records[id].synthetic).length,
    },
    stats: {
      avgConfirmMs: confirmTimes.length ? Math.round((confirmTimes.reduce((a, b) => a + b, 0) / confirmTimes.length) * 10) / 10 : null,
      txLastMinute: lastMinute,
    },
    latestVerified: verifySnapshot(head.headId, head.snapshot),
    snapshots: recent.map((s) => ({
      epoch: s.epoch,
      snapshotId: s.snapshotId,
      updateType: s.updateType,
      recordId: s.recordId,
      label: s.label,
      synthetic: s.synthetic,
      permittedActors: s.records[s.recordId] ? s.records[s.recordId].permittedActors : [],
      confirmMs: s.confirmMs,
      acceptedAt: s.acceptedAt,
      signatures: (s.signatures || []).length,
      digest: s.digest,
    })),
  };
}

// Times real in-memory permission lookups against the current snapshot.
function benchmarkLookups(headId = DEFAULT_HEAD_ID, iterations = 500) {
  const head = getHead(headId);
  const records = head.snapshot.records || {};
  const ids = Object.keys(records);
  if (!ids.length) return { iterations: 0, avgMs: 0, p95Ms: 0 };
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const id = ids[i % ids.length];
    const t0 = process.hrtime.bigint();
    // Same check the permission service does: is the actor in the snapshot's list?
    const rec = records[id];
    // eslint-disable-next-line no-unused-expressions
    rec && rec.permittedActors.includes(PARTIES[i % 4].id);
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { iterations, avgMs: avg, p95Ms: samples[Math.floor(samples.length * 0.95)] };
}

// Pre-seed the default head so the very first read already shows activity.
seedHead(DEFAULT_HEAD_ID);

module.exports = {
  DEFAULT_HEAD_ID,
  health,
  createHead,
  proposeUpdate,
  getLatestSnapshot,
  getSnapshots,
  finalizeToChain,
  listHeads,
  getHeadStatus,
  benchmarkLookups,
  verifySnapshot,
};
