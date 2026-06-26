// src/services/hydraClient.js
// Hydra Head RPC client - works with both mock-hydra and real hydra-node
// TODO: Add mTLS authentication for production hydra-node

const axios = require('axios');
const { logger } = require('./auditLogger');

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
   * Health check - verify Hydra node is reachable
   * @returns {Promise<{ok: boolean, service: string, timestamp: number}>}
   */
  async health() {
    try {
      const response = await this.client.get('/health');
      return response.data;
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
      const response = await this.client.post('/heads', {
        parties,
        contestationPeriod
      });
      
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
      
      const response = await this.client.post(`/heads/${headId}/propose`, updatePayload);
      
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
      
      const response = await this.client.get(`/heads/${headId}/snapshot`);
      
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
      
      const response = await this.client.get(`/heads/${headId}/snapshots`);
      
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
      
      const response = await this.client.post(`/heads/${headId}/close`, {
        reason: chainConfig.reason || 'Finalization requested'
      });
      
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
      const response = await this.client.get('/heads');
      return response.data;
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

module.exports = {
  HydraClient,
  getHydraClient,
  resetHydraClient
};
