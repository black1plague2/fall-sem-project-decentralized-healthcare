const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');

// Serve the log viewer HTML page
router.get('/', logController.getLogViewerPage);

// API endpoint to fetch logs as JSON
router.get('/view', logController.getLogsData);

module.exports = router;
