const express = require('express');
const path = require('path');
const appController = require('../controllers/appController');

const router = express.Router();

// Serve the production application page
router.get('/app', appController.getAppPage);

// Serve the external JavaScript for the production application
router.get('/app-script.js', appController.getAppScript);

// Serve the enhanced demo visualization page
router.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/demo.html'));
});

// Midnight ZK health and statistics
router.get('/midnight/health', (req, res) => {
  const { getMidnightStats } = require('../services/midnightService');
  const stats = getMidnightStats();
  res.json({
    status: 'ok',
    midnight: stats,
    timestamp: new Date().toISOString()
  });
});

// Aiken smart contract health and statistics
router.get('/aiken/health', (req, res) => {
  const { getAikenStats } = require('../services/aikenService');
  const stats = getAikenStats();
  res.json({
    status: stats.validatorLoaded ? 'ok' : 'disabled',
    aiken: stats,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
