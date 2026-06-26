const Redis = require('ioredis');

// Redis client singleton
let redisClient = null;
const CEK_TTL_SECONDS = parseInt(process.env.CEK_TTL_SECONDS || '300', 10); // 5 minutes default

/**
 * Initialize Redis connection (call once on app startup)
 */
async function initRedis() {
  if (redisClient) return redisClient;
  
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  // Fallback to in-memory if Redis disabled
  if (process.env.DISABLE_REDIS === 'true') {
    console.warn('⚠️  Redis disabled - using in-memory CEK storage (not production-safe)');
    redisClient = new Map(); // In-memory fallback
    return redisClient;
  }
  
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        console.error('❌ Redis connection failed after 3 retries');
        return null;
      }
      return Math.min(times * 100, 2000);
    },
  });
  
  redisClient.on('error', (err) => {
    console.error('Redis error:', err.message);
  });
  
  redisClient.on('connect', () => {
    console.log('✅ Redis connected');
  });
  
  return redisClient;
}

/**
 * Stores a CEK with TTL. CEKs auto-expire for security.
 * Redis mode: Distributed storage across instances
 * In-memory mode: Local Map (fallback, crashes purge CEKs)
 * @param {string} recordId
 * @param {Buffer} cek
 */
async function storeTempCEK(recordId, cek) {
  if (!recordId || !Buffer.isBuffer(cek)) {
    throw new Error('recordId and CEK buffer required');
  }
  
  if (!redisClient) await initRedis();
  
  // In-memory fallback
  if (redisClient instanceof Map) {
    redisClient.set(recordId, cek);
    // Simulate TTL with setTimeout
    setTimeout(() => redisClient.delete(recordId), CEK_TTL_SECONDS * 1000);
    return;
  }
  
  // Redis storage (base64 encoding for binary data)
  const cekBase64 = cek.toString('base64');
  await redisClient.setex(`cek:${recordId}`, CEK_TTL_SECONDS, cekBase64);
  console.info(`CEK stored for ${recordId} with ${CEK_TTL_SECONDS}s TTL`);
}

/**
 * Retrieves a CEK for short-lived workflows. Returns null if not found or expired.
 * @param {string} recordId
 * @returns {Promise<Buffer|null>}
 */
async function getTempCEK(recordId) {
  if (!redisClient) await initRedis();
  
  // In-memory fallback
  if (redisClient instanceof Map) {
    return redisClient.get(recordId) || null;
  }
  
  // Redis retrieval
  const cekBase64 = await redisClient.get(`cek:${recordId}`);
  if (!cekBase64) return null;
  
  return Buffer.from(cekBase64, 'base64');
}

/**
 * Deletes the temporary CEK immediately (e.g., after wrapping completes).
 * @param {string} recordId
 */
async function deleteTempCEK(recordId) {
  if (!redisClient) await initRedis();
  
  // In-memory fallback
  if (redisClient instanceof Map) {
    redisClient.delete(recordId);
    return;
  }
  
  // Redis deletion
  await redisClient.del(`cek:${recordId}`);
  console.info(`CEK deleted for ${recordId}`);
}

/**
 * Health check for Redis connection
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  if (!redisClient) await initRedis();
  
  if (redisClient instanceof Map) {
    return true; // In-memory always "healthy"
  }
  
  try {
    await redisClient.ping();
    return true;
  } catch (err) {
    console.error('Redis health check failed:', err.message);
    return false;
  }
}

/**
 * Close Redis connection (call on app shutdown)
 */
async function closeRedis() {
  if (redisClient && !(redisClient instanceof Map)) {
    await redisClient.quit();
    console.log('Redis connection closed');
  }
  redisClient = null;
}

module.exports = {
  initRedis,
  storeTempCEK,
  getTempCEK,
  deleteTempCEK,
  healthCheck,
  closeRedis,
};
