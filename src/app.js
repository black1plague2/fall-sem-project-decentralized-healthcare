require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const mongoose = require('mongoose');
const encryptionRoutes = require('./routes/encryptionRoutes');
const actorRoutes = require('./routes/actorRoutes');
const demoRoutes = require('./routes/demoRoutes');
const appRoutes = require('./routes/appRoutes');
const hydraRoutes = require('./routes/hydraRoutes');
const logRoutes = require('./routes/logRoutes');
const { initRedis, healthCheck } = require('./services/cekManager');
const { standardLimiter } = require('./services/rateLimiter');

// ============================================================================
// Cardano configuration
// ============================================================================
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const BLOCKFROST_PROJECT_ID = process.env.BLOCKFROST_PROJECT_ID;
const CARDANO_NETWORK = process.env.CARDANO_NETWORK || 'testnet';
const blockfrostConfigured = Boolean(BLOCKFROST_PROJECT_ID && BLOCKFROST_PROJECT_ID !== 'your-blockfrost-project-id');

if (!blockfrostConfigured) {
  if (!DEMO_MODE) {
    console.error('\n❌ FATAL ERROR: BLOCKFROST_PROJECT_ID not configured\n');
    console.error('This application requires Cardano blockchain integration.');
    console.error('Get your API key from: https://blockfrost.io\n');
    console.error('Set in .env file:');
    console.error('  BLOCKFROST_PROJECT_ID=mainnetXXXXXXXXXXXXXXXXXXXXXXXX');
    console.error('  CARDANO_NETWORK=mainnet  # or testnet\n');
    process.exit(1);
  }
  console.warn('\n⚠️  DEMO_MODE: BLOCKFROST_PROJECT_ID not set.');
  console.warn('   Permission checks will resolve via Hydra L2 / local DB fallback instead.');
  console.warn('   Add a real key to .env and set DEMO_MODE=false to go live.\n');
}

// Warn about demo/test mode
if (process.env.SIGNATURE_SHARED_SECRET) {
  console.warn('\n⚠️  WARNING: SIGNATURE_SHARED_SECRET is set (deprecated)');
  console.warn('HMAC signatures are disabled in production.');
  console.warn('Remove SIGNATURE_SHARED_SECRET from .env file.');
  console.warn('All signatures must come from Cardano wallets (CIP-8).\n');
}

console.log(`\n${DEMO_MODE ? '🧪' : '✅'} Cardano Configuration (${DEMO_MODE ? 'DEMO MODE' : 'PRODUCTION MODE'}):`);
console.log(`   Network: ${CARDANO_NETWORK}`);
console.log(`   Blockfrost: ${blockfrostConfigured ? BLOCKFROST_PROJECT_ID.substring(0, 10) + '...' : 'not configured (mock fallback)'}`);
console.log(`   Wallet Signatures: ${DEMO_MODE ? 'DEMO bypass (placeholder)' : 'CIP-8 (Lucid) ✓'}`);
console.log(`   Permission Verification: ${blockfrostConfigured ? 'On-chain (Blockfrost) ✓' : 'Hydra L2 + local DB fallback'}\n`);

const app = express();

// Vercel's edge sits in front of every request and sets X-Forwarded-For;
// without this, Express doesn't trust that header and express-rate-limit
// can't correctly identify clients behind the proxy.
app.set('trust proxy', 1);

// Prometheus metrics setup
const metricsRegistry = new Map();
function incrementMetric(metricName, labels = {}) {
  const key = `${metricName}:${JSON.stringify(labels)}`;
  const current = metricsRegistry.get(key) || 0;
  metricsRegistry.set(key, current + 1);
}

function recordLatency(metricName, duration, labels = {}) {
  const key = `${metricName}_latency:${JSON.stringify(labels)}`;
  const metrics = metricsRegistry.get(key) || [];
  metrics.push(duration);
  metricsRegistry.set(key, metrics);
}

// Middleware to track requests for Prometheus
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    incrementMetric('http_request_total', {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode
    });
    recordLatency('http_request_duration', duration, {
      method: req.method,
      route: req.route?.path || req.path
    });
  });
  
  next();
});

app.use(helmet());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply standard rate limiting to all routes
app.use(standardLimiter);

// Health check endpoint (no rate limiting)
app.get('/health', async (req, res) => {
  const redisHealthy = await healthCheck();
  res.json({
    status: 'ok',
    redis: redisHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Transparency endpoint: tells the frontend which layers are real vs mocked
// so the demo UI can honestly label LIVE vs MOCK badges per layer.
app.get('/api/config', (req, res) => {
  const { getAikenStats } = require('./services/aikenService');
  const { getMidnightStats } = require('./services/midnightService');
  res.json({
    demoMode: DEMO_MODE,
    network: CARDANO_NETWORK,
    layers: {
      encryption: { mode: 'live', detail: 'AES-256-GCM + RSA-OAEP (Node crypto, always real)' },
      ipfs: {
        mode: process.env.MOCK_IPFS_UPLOAD === 'true' ? 'mock' : 'live',
        provider: process.env.IPFS_PROVIDER || 'local',
      },
      hydra: {
        mode: (process.env.HYDRA_RPC_BASE || 'http://localhost:4001').includes('localhost') ? 'mock' : 'live',
        baseUrl: process.env.HYDRA_RPC_BASE || 'http://localhost:4001',
      },
      aiken: (() => {
        const s = getAikenStats();
        return { mode: s.enabled && s.validatorLoaded ? 'live' : 'disabled', ...s };
      })(),
      midnight: (() => {
        const s = getMidnightStats();
        return { mode: s.enabled ? 'mock' : 'disabled', ...s };
      })(),
      blockfrost: { mode: blockfrostConfigured ? 'live' : 'disabled', network: CARDANO_NETWORK },
      walletSignatures: { mode: DEMO_MODE ? 'demo-bypass' : 'cip-8' },
    },
  });
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  const lines = [];
  
  for (const [key, value] of metricsRegistry.entries()) {
    const [metricName, labelsStr] = key.split(':');
    
    if (metricName.includes('_latency')) {
      // Calculate latency percentiles
      const values = value.sort((a, b) => a - b);
      const p50 = values[Math.floor(values.length * 0.5)] || 0;
      const p95 = values[Math.floor(values.length * 0.95)] || 0;
      const p99 = values[Math.floor(values.length * 0.99)] || 0;
      
      lines.push(`# TYPE ${metricName}_seconds summary`);
      lines.push(`${metricName}_seconds{${labelsStr.slice(1, -1)},quantile="0.5"} ${(p50 / 1000).toFixed(3)}`);
      lines.push(`${metricName}_seconds{${labelsStr.slice(1, -1)},quantile="0.95"} ${(p95 / 1000).toFixed(3)}`);
      lines.push(`${metricName}_seconds{${labelsStr.slice(1, -1)},quantile="0.99"} ${(p99 / 1000).toFixed(3)}`);
    } else {
      lines.push(`# TYPE ${metricName} counter`);
      lines.push(`${metricName}{${labelsStr.slice(1, -1)}} ${value}`);
    }
  }
  
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

// Serve static files from public directory
app.use(express.static('public'));

// Cached connection promise, keyed so a failed attempt doesn't get stuck:
// on serverless, a fire-and-forget mongoose.connect() on cold start loses
// the race against the very first incoming request (the connection isn't
// established yet, so Mongoose buffers the query and times out at 10s).
// dbReady() is awaited by a middleware below so every request actually
// waits for a real connection (or a fast-resolving already-connected one)
// before it reaches a route that touches Mongoose.
let dbConnectPromise = null;
function dbReady() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!dbConnectPromise) {
    const dbUri = process.env.DB_URI || 'mongodb://localhost:27017/cardano-vault';
    dbConnectPromise = mongoose
      .connect(dbUri, { autoIndex: true, serverSelectionTimeoutMS: 8000 })
      .then(() => console.info('✅ MongoDB connected'))
      .catch((err) => {
        console.error('❌ MongoDB connection failed:', err.message);
        dbConnectPromise = null; // allow the next request to retry
        throw err;
      });
  }
  return dbConnectPromise;
}

// Placed after static/health/config/metrics (which don't touch Mongoose, so
// they stay fast) and before every route below that does.
app.use(async (req, res, next) => {
  try {
    await dbReady();
  } catch (err) {
    // Don't block the request here — let the specific route's own query
    // fail with a normal error instead of a 10s buffering timeout.
  }
  next();
});

app.use(encryptionRoutes);
app.use(actorRoutes);
app.use(demoRoutes);
app.use(appRoutes);
app.use('/api/hydra', hydraRoutes);
app.use('/api/logs', logRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Unexpected error' });
});

async function start() {
  await dbReady().catch(() => {});

  // Initialize Redis for CEK storage
  try {
    await initRedis();
  } catch (err) {
    console.error('❌ Redis init failed:', err.message);
  }

  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => {
    console.info(`✅ Encryption service listening on port ${port}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start service', err);
    process.exit(1);
  });
} else {
  // Imported as a module rather than run directly — this is the Vercel
  // serverless entry point path (api/index.js requires this file). DB
  // connection is handled by the dbReady() middleware above (awaited per
  // request, so it can't lose the cold-start race); Redis has no such
  // per-request gate, so kick it off eagerly here.
  initRedis().catch((err) => console.error('❌ Redis init failed:', err.message));
}

module.exports = app;
module.exports.incrementMetric = incrementMetric;
module.exports.recordLatency = recordLatency;
