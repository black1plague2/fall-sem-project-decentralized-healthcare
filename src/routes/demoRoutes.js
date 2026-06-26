const express = require('express');
const router = express.Router();
const demoController = require('../controllers/demoController');

// Serve the interactive encryption demo page
router.get('/demo', demoController.getDemoPage);

// Serve the external JavaScript for the demo page
router.get('/demo-script.js', demoController.getDemoScript);

module.exports = router;
