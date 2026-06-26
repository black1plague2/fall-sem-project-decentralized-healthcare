require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const mongoose = require('mongoose');
const encryptionRoutes = require('./routes/encryptionRoutes');
const actorRoutes = require('./routes/actorRoutes');
const demoRoutes = require('./routes/demoRoutes');
const appRoutes = require('./routes/appRoutes');
const hydraRoutes = require('./routes/hydraRoutes');
const { initRedis, healthCheck } = require('./services/cekManager');
const { standardLimiter } = require('./services/rateLimiter');

// ============================================================================
// PRODUCTION MODE: Validate required Cardano configuration
// ============================================================================
const BLOCKFROST_PROJECT_ID = process.env.BLOCKFROST_PROJECT_ID;
const CARDANO_NETWORK = process.env.CARDANO_NETWORK || 'testnet';

if (!BLOCKFROST_PROJECT_ID || BLOCKFROST_PROJECT_ID === 'your-blockfrost-project-id') {
  console.error('\n❌ FATAL ERROR: BLOCKFROST_PROJECT_ID not configured\n');
  console.error('This application requires Cardano blockchain integration.');
  console.error('Get your API key from: https://blockfrost.io\n');
  console.error('Set in .env file:');
  console.error('  BLOCKFROST_PROJECT_ID=mainnetXXXXXXXXXXXXXXXXXXXXXXXX');
  console.error('  CARDANO_NETWORK=mainnet  # or testnet\n');
  process.exit(1);
}

// Warn about demo/test mode
if (process.env.SIGNATURE_SHARED_SECRET) {
  console.warn('\n⚠️  WARNING: SIGNATURE_SHARED_SECRET is set (deprecated)');
  console.warn('HMAC signatures are disabled in production.');
  console.warn('Remove SIGNATURE_SHARED_SECRET from .env file.');
  console.warn('All signatures must come from Cardano wallets (CIP-8).\n');
}

console.log('\n✅ Cardano Configuration:');
console.log(`   Network: ${CARDANO_NETWORK}`);
console.log(`   Blockfrost: ${BLOCKFROST_PROJECT_ID.substring(0, 10)}...`);
console.log('   Wallet Signatures: CIP-8 (Lucid) ✓');
console.log('   Permission Verification: On-chain (Blockfrost) ✓\n');

const app = express();

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

app.use(encryptionRoutes);
app.use(actorRoutes);
app.use(demoRoutes);
app.use(appRoutes);
app.use('/api/hydra', hydraRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Unexpected error' });
});

async function start() {
  const dbUri = process.env.DB_URI || 'mongodb://localhost:27017/cardano-vault';
  
  try {
    await mongoose.connect(dbUri, { autoIndex: true });
    console.info('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.warn('⚠️  Server will start but database operations will fail');
    console.warn('⚠️  Start MongoDB with: docker run -d -p 27017:27017 mongo:7.0');
  }
  
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
}

module.exports = app;
module.exports.incrementMetric = incrementMetric;
module.exports.recordLatency = recordLatency;
