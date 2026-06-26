/**
 * Rate Limiting Middleware for API Security
 * 
 * Implements multi-tier rate limiting:
 * 1. Per-IP rate limiting (prevents DDoS)
 * 2. Per-wallet-address rate limiting (prevents abuse)
 * 
 * Uses express-rate-limit with Redis store for distributed deployments
 */

const rateLimit = require('express-rate-limit');
const { logger } = require('./auditLogger');

/**
 * Standard rate limiter for general API endpoints
 * 100 requests per 15 minutes per IP
 */
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('[RateLimiter] Standard rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later',
      retryAfter: '15 minutes'
    });
  }
});

/**
 * Strict rate limiter for sensitive authentication endpoints
 * 60 requests per minute per IP
 */
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per minute
  message: {
    error: 'Too many authentication requests, please try again later',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
  handler: (req, res) => {
    logger.warn('[RateLimiter] Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      body: {
        recordId: req.body?.recordId,
        actorId: req.body?.actorId
      }
    });
    res.status(429).json({
      error: 'Too many authentication requests from this IP',
      retryAfter: '1 minute'
    });
  }
});

/**
 * Very strict rate limiter for critical operations (wrap keys, revoke)
 * 10 requests per minute per IP
 */
const criticalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per minute
  message: {
    error: 'Too many critical operation requests, please try again later',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('[RateLimiter] Critical rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      body: {
        recordId: req.body?.recordId,
        actorId: req.body?.actorId,
        ownerAddr: req.body?.ownerAddr
      }
    });
    res.status(429).json({
      error: 'Too many critical operation requests from this IP',
      retryAfter: '1 minute'
    });
  }
});

/**
 * Wallet-address specific rate limiter (custom implementation)
 * 10 requests per minute per wallet address for sensitive operations
 * 
 * This middleware should be applied AFTER IP rate limiting for defense in depth
 */
const walletAddressTracker = new Map(); // In production, use Redis

function walletAddressLimiter(req, res, next) {
  // Extract wallet address from request
  const walletAddress = req.body?.ownerAddr || req.body?.actorAddr || req.query?.address;
  
  if (!walletAddress) {
    // If no wallet address, skip this limiter (IP limiter still applies)
    return next();
  }

  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10;

  // Get or initialize tracker for this wallet
  let tracker = walletAddressTracker.get(walletAddress);
  
  if (!tracker) {
    tracker = { requests: [], windowStart: now };
    walletAddressTracker.set(walletAddress, tracker);
  }

  // Clean up old requests outside the window
  tracker.requests = tracker.requests.filter(timestamp => now - timestamp < windowMs);

  // Check if limit exceeded
  if (tracker.requests.length >= maxRequests) {
    logger.warn('[RateLimiter] Wallet address rate limit exceeded', {
      walletAddress: walletAddress.substring(0, 20) + '...',
      ip: req.ip,
      path: req.path,
      requestCount: tracker.requests.length
    });

    return res.status(429).json({
      error: 'Too many requests from this wallet address',
      retryAfter: '1 minute',
      limit: maxRequests,
      window: '1 minute'
    });
  }

  // Add current request
  tracker.requests.push(now);
  
  // Cleanup old trackers (memory management)
  if (walletAddressTracker.size > 10000) {
    // Remove entries older than 5 minutes
    const cleanupThreshold = now - (5 * 60 * 1000);
    for (const [addr, track] of walletAddressTracker.entries()) {
      if (track.requests.length === 0 || track.requests[track.requests.length - 1] < cleanupThreshold) {
        walletAddressTracker.delete(addr);
      }
    }
  }

  next();
}

/**
 * Create Redis-backed rate limiter store (for production)
 * 
 * Usage:
 * const { RedisStore } = require('rate-limit-redis');
 * const Redis = require('ioredis');
 * 
 * const redisClient = new Redis(process.env.REDIS_URL);
 * 
 * const redisLimiter = rateLimit({
 *   windowMs: 60 * 1000,
 *   max: 10,
 *   store: new RedisStore({
 *     client: redisClient,
 *     prefix: 'rl:',
 *   }),
 * });
 */

/**
 * Combined rate limiter for sensitive operations
 * Applies both IP-based and wallet-based rate limiting
 */
function sensitiveLimiter(req, res, next) {
  criticalLimiter(req, res, (err) => {
    if (err) return next(err);
    walletAddressLimiter(req, res, next);
  });
}

module.exports = {
  standardLimiter,
  authLimiter,
  criticalLimiter,
  walletAddressLimiter,
  sensitiveLimiter
};
