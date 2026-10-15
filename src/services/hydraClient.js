// src/services/hydraClient.js
// Hydra Head RPC client - works with both mock-hydra and real hydra-node
// TODO: Add mTLS authentication for production hydra-node

const axios = require('axios');
const { logger } = require('./auditLogger');

const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH']);
function isUnreachable(error) {
  return !error.response && (UNREACHABLE_CODES.has(error.code) || /timeout|ECONNREFUSED/i.test(error.message || ''));
}

class HydraClient {
  /**
   * @param {Object} config
   * @param {string} config.hydraBaseUrl - Hydra node RPC endpoint
   * @param {string} config.apiKey - API key for authentication (optional for mock)
   * @param {number} config.timeout - Request timeout in ms (default: 30000)
   */
  constructor(config = {}) {
    this.baseUrl = config.hydraBaseUrl || process.env.HYDRA_RPC_BASE || 'http://localhost:4001';
    this.apiKey = config.apiKey || process.env.HYDRA_RPC_KEY || '';
    this.timeout = config.timeout || 30000;

    // 'simulated' forces the in-process simulator, 'remote' forces the RPC
    // node, 'auto' (default) uses the node and falls back to the simulator
    // the first time the node turns out to be unreachable.
    this.preference = (config.mode || process.env.HYDRA_MODE || 'auto').toLowerCase();
    this.mode = this.preference === 'simulated' ? 'simulated' : 'remote';
    this.fallbackReason = this.mode === 'simulated' ? 'HYDRA_MODE=simulated' : null;
    
    // Create axios instance
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'X-API-Key': this.apiKey })
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.info('[HydraClient] Request', {
          method: config.method,
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        logger.error('[HydraClient] Request error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.info('[HydraClient] Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        logger.error('[HydraClient] Response error', {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );

    logger.info('[HydraClient] Initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
      timeout: this.timeout
    });
  }

  /**
   * Runs `remoteFn` against the RPC node, or `simFn` against the in-process
   * simulator. In 'auto' mode, a network-level failure (nothing listening,
   * DNS, timeout) switches this client to the simulator for good.
   */
  async _run(remoteFn, simFn) {
    if (this.mode === 'simulated') return simFn(require('./hydraSimulator'));
    try {
      return await remoteFn();
    } catch (error) {
      if (this.preference !== 'auto' || !isUnreachable(error)) throw error;
      this.mode = 'simulated';
      this.fallbackReason = `Hydra node at ${this.baseUrl} unreachable (${error.code || error.message})`;
      logger.warn('[HydraClient] Falling back to in-process simulator', { reason: this.fallbackReason });
      return simFn(require('./hydraSimulator'));
    }
  }

  /**
   * Works out which mode is in use, probing the node once if needed.
   * @returns {Promise<'remote'|'simulated'>}
   */
  async resolveMode() {
    if (this.mode === 'simulated' || this._probed) return this.mode;
    this._probed = true;
    try {
      await this._run(() => this.client.get('/health', { timeout: 1500 }), () => null);
    } catch (e) { /* remote answered with an error: still remote */ }
    return this.mode;
  }

  /**
   * Health check - verify Hydra node is reachable
   * @returns {Promise<{ok: boolean, service: string, timestamp: number}>}
   */
  async health() {
    try {
      return await this._run(
        async () => (await this.client.get('/health')).data,
        (sim) => sim.health()
      );
    } catch (error) {
      throw new Error(`Hydra health check failed: ${error.message}`);
    }
  }

  /**
   * Create a new Hydra head
   * @param {Object} params
   * @param {string[]} params.parties - Participant addresses
   * @param {number} params.contestationPeriod - Seconds for dispute window
   * @returns {Promise<{headId: string, status: string}>}
   * 
   * TODO: Real hydra-node requires on-chain TX to open head (costs 5-10 ADA locked)
   */
  async createHead({ parties = [], contestationPeriod = 60 }) {
    try {
      const response = await this._run(
        async () => this.client.post('/heads', { parties, contestationPeriod }),
        async (sim) => ({ data: await sim.createHead({ parties, contestationPeriod }) })
      );
      
      logger.info('[HydraClient] Head created', {
        headId: response.data.headId,
        parties: parties.length
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create Hydra head: ${error.message}`);
    }
  }

  /**
   * Propose an update to Hydra head (off-chain state change)
   * @param {string} headId - Head identifier
   * @param {Object} updatePayload - Update data
   * @param {string} updatePayload.type - Update type (e.g., 'SHARE_RECORD')
   * @param {string} updatePayload.recordId - Record identifier
   * @param {string} updatePayload.cidHash - IPFS CID hash
   * @param {Array} updatePayload.wrappedKeys - Encrypted keys for actors
   * @param {string} updatePayload.author - Update author address
   * @param {number} updatePayload.timestamp - Unix timestamp
   * @returns {Promise<{status: string, snapshotId: string, snapshot: Object}>}
   * 
   * TODO: Real hydra-node requires multi-party signatures before acceptance
   */
  async proposeUpdate(headId, updatePayload) {
    try {
      if (!headId) {
        throw new Error('headId is required');
      }
      
      if (!updatePayload.type || !updatePayload.recordId) {
        throw new Error('updatePayload must contain type and recordId');
      }
      
      const response = await this._run(
        async () => this.client.post(`/heads/${headId}/propose`, updatePayload),
        async (sim) => ({ data: await sim.proposeUpdate(headId, updatePayload) })
      );
      
      logger.info('[HydraClient] Update proposed', {
        headId,
        snapshotId: response.data.snapshotId,
        status: response.data.status,
        recordId: updatePayload.recordId
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Hydra head not found: ${headId}`);
      }
      if (error.response?.status === 400) {
        throw new Error(`Invalid update proposal: ${error.response.data?.error || error.message}`);
      }
      throw new Error(`Failed to propose update: ${error.message}`);
    }
  }

  /**
   * Get latest snapshot for a head
   * @param {string} headId - Head identifier
   * @returns {Promise<{headId: string, status: string, snapshot: Object}>}
   */
  async getLatestSnapshot(headId) {
    try {
      if (!headId) {
        throw new Error('headId is required');
      }
      
      const response = await this._run(
        async () => this.client.get(`/heads/${headId}/snapshot`),
        async (sim) => ({ data: await sim.getLatestSnapshot(headId) })
      );
      
      logger.info('[HydraClient] Snapshot retrieved', {
        headId,
        epoch: response.data.snapshot?.epoch,
        recordsCount: Object.keys(response.data.snapshot?.records || {}).length
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Hydra head not found: ${headId}`);
      }
      throw new Error(`Failed to get snapshot: ${error.message}`);
    }
  }

  /**
   * Get all snapshots (history) for a head
   * @param {string} headId - Head identifier
   * @returns {Promise<{headId: string, snapshots: Array, count: number}>}
   */
  async getSnapshots(headId) {
    try {
      if (!headId) {
        throw new Error('headId is required');
      }
      
      const response = await this._run(
        async () => this.client.get(`/heads/${headId}/snapshots`),
        async (sim) => ({ data: await sim.getSnapshots(headId) })
      );
      
      logger.info('[HydraClient] Snapshots retrieved', {
        headId,
        count: response.data.count
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Hydra head not found: ${headId}`);
      }
      throw new Error(`Failed to get snapshots: ${error.message}`);
    }
  }

  /**
   * Close Hydra head and finalize to L1 (Cardano mainnet/testnet)
   * @param {string} headId - Head identifier
   * @param {Object} chainConfig - Chain finalization config
   * @param {string} chainConfig.reason - Reason for closing
   * @returns {Promise<{status: string, txHash: string, snapshot: Object}>}
   * 
   * TODO: Real hydra-node submits finalization TX to Cardano (requires ADA for fees)
   * TODO: Implement proper dispute window handling before finalization
   */
  async finalizeToChain(headId, chainConfig = {}) {
    try {
      if (!headId) {
        throw new Error('headId is required');
      }
      
      const reason = chainConfig.reason || 'Finalization requested';
      const response = await this._run(
        async () => this.client.post(`/heads/${headId}/close`, { reason }),
        async (sim) => ({ data: await sim.finalizeToChain(headId, { reason }) })
      );
      
      logger.info('[HydraClient] Head closed and finalized', {
        headId,
        txHash: response.data.txHash,
        status: response.data.status
      });
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Hydra head not found: ${headId}`);
      }
      if (error.response?.status === 400) {
        throw new Error(`Cannot close head: ${error.response.data?.error || error.message}`);
      }
      throw new Error(`Failed to finalize to chain: ${error.message}`);
    }
  }

  /**
   * List all heads (dev utility, may not be available in production)
   * @returns {Promise<{heads: Array, count: number}>}
   */
  async listHeads() {
    try {
      return await this._run(
        async () => (await this.client.get('/heads')).data,
        (sim) => sim.listHeads()
      );
    } catch (error) {
      // Not all hydra-node implementations support this
      logger.warn('[HydraClient] List heads not supported', { error: error.message });
      return { heads: [], count: 0 };
    }
  }
}

// Singleton instance
let hydraClientInstance = null;

/**
 * Get or create HydraClient singleton
 * @param {Object} config - Optional config (only used on first call)
 * @returns {HydraClient}
 */
function getHydraClient(config) {
  if (!hydraClientInstance) {
    hydraClientInstance = new HydraClient(config);
  }
  return hydraClientInstance;
}

/**
 * Reset singleton (for testing)
 */
function resetHydraClient() {
  hydraClientInstance = null;
}

// ============================================================
// DEMO CONVENIENCE: lazily create a Hydra head for the 4 demo
// actors so a fresh checkout works without manually creating one
// via POST /api/hydra/heads first. Set DEFAULT_HYDRA_HEAD in .env
// to pin a specific head instead (e.g. for a real hydra-node).
// ============================================================
let cachedDefaultHeadId = process.env.DEFAULT_HYDRA_HEAD || null;
let pendingDefaultHead = null;

async function getOrCreateDefaultHead() {
  if (cachedDefaultHeadId) return cachedDefaultHeadId;
  if (pendingDefaultHead) return pendingDefaultHead;

  pendingDefaultHead = (async () => {
    const client = getHydraClient();
    // A fixed id keeps every serverless instance on the same simulated head.
    if (await client.resolveMode() === 'simulated') {
      cachedDefaultHeadId = require('./hydraSimulator').DEFAULT_HEAD_ID;
      return cachedDefaultHeadId;
    }
    const result = await client.createHead({
      parties: ['01', '02', '03', '04'],
      contestationPeriod: 60,
    });
    cachedDefaultHeadId = result.headId;
    logger.info('[HydraClient] Auto-created demo head', { headId: cachedDefaultHeadId });
    return cachedDefaultHeadId;
  })();

  try {
    return await pendingDefaultHead;
  } finally {
    pendingDefaultHead = null;
  }
}

function resetDefaultHead() {
  cachedDefaultHeadId = process.env.DEFAULT_HYDRA_HEAD || null;
}

/**
 * Proposes the current access list of one record to the default head and
 * stores the accepted snapshot in MongoDB (where the permission service
 * reads it). Used after a revoke so the L2 view drops the removed actor.
 */
async function publishRecordToHydra({ type, recordId, cidHash, actorIds, author }) {
  const HydraSnapshot = require('../models/hydraSnapshotModel');
  const headId = await getOrCreateDefaultHead();
  const client = getHydraClient();
  const wrappedKeys = actorIds.map((actorId) => ({ actorId, wrappedKey: 'held-in-record', ephemeralPublicKey: 'n/a' }));
  const response = await client.proposeUpdate(headId, { type, recordId, cidHash, wrappedKeys, author, timestamp: Date.now() });
  if (response.status !== 'accepted') throw new Error(`Hydra did not accept update (${response.status})`);

  await HydraSnapshot.create({
    headId,
    snapshotId: response.snapshotId,
    epoch: response.epoch,
    snapshot: { epoch: response.epoch, snapshotId: response.snapshotId, updateType: type, recordId },
    status: 'accepted',
    records: [{ recordId, cidHash, permittedActors: actorIds, wrappedKeys, author, lastUpdated: new Date() }],
    acceptedAt: new Date(),
  });
  return { headId, snapshotId: response.snapshotId, epoch: response.epoch, mode: client.mode };
}

module.exports = {
  HydraClient,
  publishRecordToHydra,
  getHydraClient,
  resetHydraClient,
  getOrCreateDefaultHead,
  resetDefaultHead,
};
