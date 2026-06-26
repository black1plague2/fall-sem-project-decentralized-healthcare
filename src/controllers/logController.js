const fs = require('fs');
const path = require('path');
const { logger } = require('../services/auditLogger');

/**
 * Serve the log viewer HTML page
 */
function getLogViewerPage(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cardano Healthcare Vault - Log Viewer</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            overflow: hidden;
        }
        
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        header h1 {
            font-size: 2em;
            margin-bottom: 10px;
        }
        
        header p {
            opacity: 0.9;
        }
        
        .controls {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            padding: 20px;
            background: #f8f9fa;
            border-bottom: 2px solid #e9ecef;
        }
        
        .control-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .control-group label {
            font-weight: 600;
            color: #495057;
        }
        
        select, input, button {
            padding: 10px 15px;
            border: 2px solid #dee2e6;
            border-radius: 6px;
            font-size: 14px;
            transition: all 0.3s;
        }
        
        select:focus, input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        button {
            background: #667eea;
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 600;
        }
        
        button:hover {
            background: #5568d3;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            padding: 20px;
            background: #f8f9fa;
        }
        
        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .stat-card .label {
            font-size: 12px;
            color: #6c757d;
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .stat-card .value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }
        
        .log-container {
            padding: 20px;
            max-height: 600px;
            overflow-y: auto;
        }
        
        .log-entry {
            margin-bottom: 15px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #6c757d;
            transition: all 0.2s;
        }
        
        .log-entry:hover {
            background: #e9ecef;
            transform: translateX(5px);
        }
        
        .log-entry.info { border-left-color: #0dcaf0; }
        .log-entry.warn { border-left-color: #ffc107; background: #fff9e6; }
        .log-entry.error { border-left-color: #dc3545; background: #ffe6e6; }
        .log-entry.debug { border-left-color: #6c757d; }
        
        .log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            flex-wrap: wrap;
            gap: 10px;
        }
        
        .log-level {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .log-level.info { background: #0dcaf0; color: white; }
        .log-level.warn { background: #ffc107; color: #000; }
        .log-level.error { background: #dc3545; color: white; }
        .log-level.debug { background: #6c757d; color: white; }
        
        .log-timestamp {
            color: #6c757d;
            font-size: 13px;
            font-family: 'Courier New', monospace;
        }
        
        .log-message {
            margin-bottom: 10px;
            line-height: 1.6;
        }
        
        .log-meta {
            background: white;
            padding: 10px;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #495057;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .no-logs {
            text-align: center;
            padding: 60px 20px;
            color: #6c757d;
        }
        
        .no-logs svg {
            width: 80px;
            height: 80px;
            margin-bottom: 20px;
            opacity: 0.3;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
        }
        
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .auto-refresh {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .toggle-switch {
            position: relative;
            width: 50px;
            height: 24px;
        }
        
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
            border-radius: 24px;
        }
        
        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }
        
        input:checked + .slider {
            background-color: #667eea;
        }
        
        input:checked + .slider:before {
            transform: translateX(26px);
        }
        
        @media (max-width: 768px) {
            .controls {
                flex-direction: column;
            }
            
            .log-header {
                flex-direction: column;
                align-items: flex-start;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🏥 Cardano Healthcare Vault</h1>
            <p>Real-Time Log Viewer & Monitor</p>
        </header>
        
        <div class="controls">
            <div class="control-group">
                <label for="logType">Log Type:</label>
                <select id="logType">
                    <option value="combined">All Logs (Combined)</option>
                    <option value="audit">Audit Logs</option>
                    <option value="error">Error Logs</option>
                </select>
            </div>
            
            <div class="control-group">
                <label for="logLevel">Filter Level:</label>
                <select id="logLevel">
                    <option value="all">All Levels</option>
                    <option value="info">Info</option>
                    <option value="warn">Warning</option>
                    <option value="error">Error</option>
                    <option value="debug">Debug</option>
                </select>
            </div>
            
            <div class="control-group">
                <label for="searchTerm">Search:</label>
                <input type="text" id="searchTerm" placeholder="Search logs...">
            </div>
            
            <div class="control-group">
                <label for="lines">Lines:</label>
                <select id="lines">
                    <option value="50">50</option>
                    <option value="100" selected>100</option>
                    <option value="200">200</option>
                    <option value="500">500</option>
                </select>
            </div>
            
            <button onclick="fetchLogs()">🔄 Refresh</button>
            <button onclick="clearFilters()">🗑️ Clear Filters</button>
            
            <div class="auto-refresh">
                <label class="toggle-switch">
                    <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()">
                    <span class="slider"></span>
                </label>
                <label for="autoRefresh">Auto-refresh (5s)</label>
            </div>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="label">Total Logs</div>
                <div class="value" id="totalLogs">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Info</div>
                <div class="value" id="infoCount" style="color: #0dcaf0;">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Warnings</div>
                <div class="value" id="warnCount" style="color: #ffc107;">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Errors</div>
                <div class="value" id="errorCount" style="color: #dc3545;">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Last Update</div>
                <div class="value" id="lastUpdate" style="font-size: 14px; color: #6c757d;">Never</div>
            </div>
        </div>
        
        <div class="log-container" id="logContainer">
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading logs...</p>
            </div>
        </div>
    </div>
    
    <script>
        let autoRefreshInterval = null;
        
        async function fetchLogs() {
            const logType = document.getElementById('logType').value;
            const lines = document.getElementById('lines').value;
            const logLevel = document.getElementById('logLevel').value;
            const searchTerm = document.getElementById('searchTerm').value;
            
            try {
                const response = await fetch(\`/api/logs/view?type=\${logType}&lines=\${lines}&level=\${logLevel}&search=\${encodeURIComponent(searchTerm)}\`);
                const data = await response.json();
                
                displayLogs(data.logs);
                updateStats(data.stats);
                document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
            } catch (error) {
                console.error('Error fetching logs:', error);
                document.getElementById('logContainer').innerHTML = \`
                    <div class="no-logs">
                        <p style="color: #dc3545;">❌ Error loading logs: \${error.message}</p>
                    </div>
                \`;
            }
        }
        
        function displayLogs(logs) {
            const container = document.getElementById('logContainer');
            
            if (!logs || logs.length === 0) {
                container.innerHTML = \`
                    <div class="no-logs">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <h3>No Logs Found</h3>
                        <p>Try adjusting your filters or check back later.</p>
                    </div>
                \`;
                return;
            }
            
            container.innerHTML = logs.map(log => {
                const level = log.level || 'info';
                const timestamp = log.timestamp || new Date().toISOString();
                const message = log.message || JSON.stringify(log);
                
                // Extract metadata (everything except level, timestamp, message)
                const meta = { ...log };
                delete meta.level;
                delete meta.timestamp;
                delete meta.message;
                delete meta.service;
                delete meta.environment;
                
                const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
                
                return \`
                    <div class="log-entry \${level}">
                        <div class="log-header">
                            <span class="log-level \${level}">\${level}</span>
                            <span class="log-timestamp">\${timestamp}</span>
                        </div>
                        <div class="log-message">\${escapeHtml(message)}</div>
                        \${metaStr ? \`<div class="log-meta">\${escapeHtml(metaStr)}</div>\` : ''}
                    </div>
                \`;
            }).join('');
        }
        
        function updateStats(stats) {
            document.getElementById('totalLogs').textContent = stats.total || 0;
            document.getElementById('infoCount').textContent = stats.info || 0;
            document.getElementById('warnCount').textContent = stats.warn || 0;
            document.getElementById('errorCount').textContent = stats.error || 0;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function clearFilters() {
            document.getElementById('logLevel').value = 'all';
            document.getElementById('searchTerm').value = '';
            fetchLogs();
        }
        
        function toggleAutoRefresh() {
            const checkbox = document.getElementById('autoRefresh');
            
            if (checkbox.checked) {
                fetchLogs();
                autoRefreshInterval = setInterval(fetchLogs, 5000);
            } else {
                if (autoRefreshInterval) {
                    clearInterval(autoRefreshInterval);
                    autoRefreshInterval = null;
                }
            }
        }
        
        // Initial load
        fetchLogs();
    </script>
</body>
</html>
  `;
  
  res.set('Content-Type', 'text/html');
  res.send(html);
}

/**
 * API endpoint to fetch logs as JSON
 */
async function getLogsData(req, res) {
  try {
    const { type = 'combined', lines = 100, level = 'all', search = '' } = req.query;
    
    const logFile = path.join(process.cwd(), 'logs', `${type}.log`);
    
    // Check if file exists
    if (!fs.existsSync(logFile)) {
      return res.json({
        logs: [],
        stats: { total: 0, info: 0, warn: 0, error: 0 },
      });
    }
    
    // Read log file
    const content = fs.readFileSync(logFile, 'utf8');
    const logLines = content.split('\n').filter(line => line.trim());
    
    // Get last N lines
    const recentLines = logLines.slice(-parseInt(lines));
    
    // Parse JSON logs
    let logs = recentLines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          // Handle non-JSON lines
          return {
            level: 'info',
            message: line,
            timestamp: new Date().toISOString(),
          };
        }
      })
      .reverse(); // Show newest first
    
    // Filter by level
    if (level !== 'all') {
      logs = logs.filter(log => log.level === level);
    }
    
    // Filter by search term
    if (search) {
      const searchLower = search.toLowerCase();
      logs = logs.filter(log => {
        const logStr = JSON.stringify(log).toLowerCase();
        return logStr.includes(searchLower);
      });
    }
    
    // Calculate stats
    const stats = {
      total: logs.length,
      info: logs.filter(l => l.level === 'info').length,
      warn: logs.filter(l => l.level === 'warn').length,
      error: logs.filter(l => l.level === 'error').length,
    };
    
    res.json({ logs, stats });
    
  } catch (error) {
    logger.error('Error fetching logs', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch logs', message: error.message });
  }
}

module.exports = {
  getLogViewerPage,
  getLogsData,
};
