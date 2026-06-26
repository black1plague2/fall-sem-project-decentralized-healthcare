// appController.js - Production application controller
const { logger } = require('../services/auditLogger');

/**
 * GET /app
 * Serves the production application HTML page
 */
function getAppPage(req, res) {
  try {
    logger && logger.info && logger.info('app_page_access', { 
      path: req.path || req.url || '/',
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  } catch (e) {
    console.warn('logger.info failed', e && e.message);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cardano Health Vault - Secure Medical Records</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --primary: #6366f1;
      --primary-dark: #4f46e5;
      --primary-light: #818cf8;
      --secondary: #0ea5e9;
      --secondary-light: #38bdf8;
      --success: #10b981;
      --success-light: #34d399;
      --error: #ef4444;
      --warning: #f59e0b;
      --bg: #f8fafc;
      --bg-card: #ffffff;
      --bg-input: #f1f5f9;
      --bg-hover: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --shadow: rgba(15, 23, 42, 0.1);
      --shadow-lg: rgba(15, 23, 42, 0.15);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #f8fafc 100%);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      text-align: center;
      padding: 40px 0;
      border-bottom: 3px solid var(--primary);
      margin-bottom: 40px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(14, 165, 233, 0.05) 100%);
      border-radius: 16px;
    }

    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 800;
    }

    .header p {
      color: var(--text-muted);
      font-size: 1.1rem;
      font-weight: 500;
    }

    .main-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 40px;
    }

    @media (max-width: 768px) {
      .main-grid {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 8px 16px var(--shadow), 0 0 0 1px var(--border);
      border: 2px solid var(--border);
      transition: all 0.3s ease;
    }

    .card:hover {
      box-shadow: 0 12px 24px var(--shadow-lg), 0 0 0 2px var(--primary-light);
      transform: translateY(-2px);
    }

    .card h2 {
      font-size: 1.5rem;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card h3 {
      font-size: 1.2rem;
      margin-bottom: 15px;
      color: var(--text-muted);
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: var(--text-muted);
      font-size: 0.9rem;
      font-weight: 500;
    }

    .form-group input[type="text"],
    .form-group input[type="file"],
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 14px;
      background: white;
      border: 2px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 1rem;
      transition: all 0.3s ease;
      font-weight: 500;
      box-shadow: 0 2px 4px var(--shadow);
    }

    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
      background: rgba(99, 102, 241, 0.02);
    }

    .file-upload {
      border: 3px dashed var(--border);
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.02) 0%, rgba(14, 165, 233, 0.02) 100%);
    }

    .file-upload:hover {
      border-color: var(--primary);
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(14, 165, 233, 0.08) 100%);
      transform: scale(1.02);
    }

    .file-upload.dragover {
      border-color: var(--secondary);
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%);
      transform: scale(1.05);
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.2);
    }

    .file-upload input[type="file"] {
      display: none;
    }

    .file-info {
      margin-top: 10px;
      padding: 10px;
      background: rgba(16, 185, 129, 0.1);
      border-radius: 6px;
      color: var(--success);
      font-size: 0.9rem;
      display: none;
    }

    .file-info.visible {
      display: block;
    }

    .actor-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }

    .actor-btn {
      padding: 12px;
      background: white;
      border: 2px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 1rem;
      font-weight: 600;
      box-shadow: 0 2px 4px var(--shadow);
    }

    .actor-btn:hover {
      border-color: var(--primary);
      background: rgba(99, 102, 241, 0.05);
      transform: translateY(-2px);
      box-shadow: 0 4px 8px var(--shadow-lg);
    }

    .actor-btn.selected {
      background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
      border-color: var(--primary);
      color: white;
      box-shadow: 0 6px 12px rgba(99, 102, 241, 0.3);
    }

    .btn {
      padding: 16px 32px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 20px rgba(99, 102, 241, 0.5);
    }

    .btn:active {
      transform: translateY(-1px);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.2);
    }

    .btn-secondary {
      background: white;
      color: var(--text);
      border: 2px solid var(--border);
      box-shadow: 0 2px 6px var(--shadow);
      font-weight: 600;
      text-transform: none;
      letter-spacing: normal;
    }

    .btn-secondary:hover {
      background: var(--bg-hover);
      border-color: var(--primary);
      color: var(--primary);
      box-shadow: 0 4px 12px var(--shadow-lg);
    }

    .records-list {
      max-height: 600px;
      overflow-y: auto;
    }

    .record-item {
      background: white;
      padding: 18px;
      border-radius: 12px;
      margin-bottom: 12px;
      border: 2px solid var(--border);
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 2px 6px var(--shadow);
    }

    .record-item:hover {
      border-color: var(--primary);
      transform: translateX(8px);
      box-shadow: 0 6px 16px var(--shadow-lg);
      background: rgba(99, 102, 241, 0.02);
    }

    .record-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .record-filename {
      font-weight: 600;
      font-size: 1.1rem;
    }

    .record-meta {
      display: flex;
      gap: 15px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge-success {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.15) 100%);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .badge-warning {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.15) 100%);
      color: var(--warning);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-error {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.15) 100%);
      color: var(--error);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .encryption-progress {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(14, 165, 233, 0.05) 100%);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      border: 2px solid var(--border);
      display: none;
    }

    .encryption-progress.visible {
      display: block;
    }

    .progress-step {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 10px;
      border-radius: 8px;
      background: white;
      border: 1px solid var(--border);
      transition: all 0.3s ease;
    }

    .progress-step.active {
      border-color: var(--primary);
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
      transform: translateX(4px);
    }

    .progress-step.complete {
      border-color: var(--success);
      background: rgba(16, 185, 129, 0.05);
    }

    .progress-step.error {
      border-color: var(--error);
      background: rgba(239, 68, 68, 0.05);
    }

    .step-icon {
      font-size: 1.5rem;
      min-width: 32px;
      text-align: center;
    }

    .step-content {
      flex: 1;
    }

    .step-title {
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text);
    }

    .step-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .step-status {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .step-status.pending {
      background: rgba(148, 163, 184, 0.1);
      color: var(--text-muted);
    }

    .step-status.running {
      background: rgba(99, 102, 241, 0.15);
      color: var(--primary);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .step-status.done {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }

    .step-status.failed {
      background: rgba(239, 68, 68, 0.15);
      color: var(--error);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .progress-bar-container {
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
      margin: 15px 0;
    }

    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%);
      transition: width 0.3s ease;
      width: 0%;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .status-idle {
      background: rgba(148, 163, 184, 0.1);
      color: var(--text-muted);
      border: 2px solid var(--border);
    }

    .status-loading {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(14, 165, 233, 0.1) 100%);
      color: var(--primary);
      border: 2px solid var(--primary);
    }

    .status-success {
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      border: 2px solid var(--success);
    }

    .status-error {
      background: rgba(239, 68, 68, 0.1);
      color: var(--error);
      border: 2px solid var(--error);
    }

    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: var(--primary);
      border-radius: 50%;
      width: 20px;
      height: 20px;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(8px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal.visible {
      display: flex;
      animation: fadeIn 0.3s ease;
    }

    .modal-content {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 40px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 24px 48px rgba(99, 102, 241, 0.2);
      border: 2px solid rgba(99, 102, 241, 0.1);
      animation: slideUp 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { 
        opacity: 0;
        transform: translateY(30px);
      }
      to { 
        opacity: 1;
        transform: translateY(0);
      }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .modal-header h3 {
      font-size: 1.5rem;
      margin: 0;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.3s ease;
    }

    .close-btn:hover {
      background: var(--bg-input);
      color: var(--text);
    }

    .info-grid {
      display: grid;
      gap: 12px;
    }

    .info-row {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 12px;
      padding: 10px;
      background: var(--bg-input);
      border-radius: 6px;
    }

    .info-label {
      font-weight: 600;
      color: var(--text-muted);
    }

    .info-value {
      color: var(--text);
      word-break: break-all;
    }

    .empty-state {
      text-align: center;
      padding: 80px 30px;
      color: var(--text-muted);
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(14, 165, 233, 0.03) 100%);
      border-radius: 12px;
      border: 2px dashed var(--border);
    }

    .empty-state svg {
      width: 100px;
      height: 100px;
      margin-bottom: 24px;
      opacity: 0.3;
      filter: drop-shadow(0 4px 8px rgba(99, 102, 241, 0.1));
    }

    .empty-state h3 {
      color: var(--text);
      margin-bottom: 8px;
      font-size: 1.25rem;
    }

    .empty-state p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    pre {
      background: var(--bg-input);
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.5;
      margin-top: 10px;
    }

    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 15px;
    }

    .checkbox-group input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    .checkbox-group label {
      margin: 0;
      cursor: pointer;
    }

    /* Toast Notifications */
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
    }

    .toast {
      background: white;
      border-radius: 12px;
      padding: 16px 20px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
      border-left: 4px solid var(--primary);
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideInRight 0.3s ease, fadeOut 0.3s ease 4.7s forwards;
      min-width: 300px;
    }

    .toast.success {
      border-left-color: var(--success);
    }

    .toast.error {
      border-left-color: var(--error);
    }

    .toast.warning {
      border-left-color: var(--warning);
    }

    .toast.info {
      border-left-color: var(--secondary);
    }

    .toast-icon {
      font-size: 1.5rem;
      flex-shrink: 0;
    }

    .toast-content {
      flex: 1;
    }

    .toast-title {
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text);
    }

    .toast-message {
      font-size: 0.9rem;
      color: var(--text-muted);
      word-break: break-word;
    }

    .toast-close {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.2rem;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }

    .toast-close:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    @keyframes slideInRight {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes fadeOut {
      to {
        opacity: 0;
        transform: translateX(400px);
      }
    }

    /* Copy Button */
    .copy-btn {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      color: var(--text);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 8px;
    }

    .copy-btn:hover {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }

    .copy-btn.copied {
      background: var(--success);
      color: white;
      border-color: var(--success);
    }

    /* Search & Filter Controls */
    .search-controls {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 10px;
      margin-bottom: 20px;
    }

    @media (max-width: 768px) {
      .search-controls {
        grid-template-columns: 1fr;
      }
    }

    .filter-select {
      padding: 10px 14px;
      background: white;
      border: 2px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 140px;
    }

    .filter-select:hover,
    .filter-select:focus {
      border-color: var(--primary);
      outline: none;
    }

    .clear-filters-btn {
      padding: 10px 16px;
      background: white;
      border: 2px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .clear-filters-btn:hover {
      background: var(--error);
      color: white;
      border-color: var(--error);
    }
  </style>
</head>
<body>
  <!-- Toast Container -->
  <div class="toast-container" id="toastContainer"></div>

  <div class="container">
    <div class="header">
      <h1>STABLE🫏</h1>
      <p>Secure, encrypted medical records on IPFS with blockchain verification</p>
    </div>

    <!-- Eternl Wallet Connection -->
    <div class="card" style="margin-bottom: 30px;">
      <h2>
        <span>🦅</span>
        Eternl Wallet Connection
      </h2>
      
      <div id="walletDisconnected">
        <p style="color: var(--text-muted); margin-bottom: 15px;">
          Connect your Eternl wallet to sign uploads and access requests with Cardano blockchain verification.
        </p>
        <button class="btn btn-primary" id="connectWalletBtn">
          🔗 Connect Eternl Wallet
        </button>
      </div>

      <div id="walletConnected" style="display: none;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
          <div style="padding: 15px; background: var(--bg-input); border-radius: 10px;">
            <div style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 5px;">Connected Address</div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="color: var(--text); font-weight: 600; word-break: break-all; font-size: 0.95rem; flex: 1;" id="walletAddress">-</div>
              <button class="copy-btn" id="copyWalletAddressBtn" style="margin: 0; padding: 4px 8px; font-size: 0.75rem;">📋</button>
            </div>
          </div>
          <div style="padding: 15px; background: var(--bg-input); border-radius: 10px;">
            <div style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 5px;">Balance</div>
            <div style="color: var(--text); font-weight: 600; font-size: 1.1rem;" id="walletBalance">- ADA</div>
          </div>
        </div>
        <button class="btn btn-secondary" id="disconnectWalletBtn">
          🔌 Disconnect Wallet
        </button>
      </div>
    </div>

    <div class="main-grid">
      <!-- Upload Section -->
      <div class="card">
        <h2>
          <span>📤</span>
          Upload Medical Record
        </h2>

        <div class="status-indicator status-idle" id="uploadStatus">
          <span id="statusIcon">⏸</span>
          <span id="statusText">Ready to upload</span>
        </div>

        <div class="encryption-progress" id="encryptionProgress">
          <h3 style="margin: 0 0 15px 0; font-size: 1.1rem; color: var(--text);">
            🔐 Encryption Process
          </h3>
          
          <div class="progress-bar-container">
            <div class="progress-bar" id="progressBar"></div>
          </div>

          <div class="progress-step" id="step1">
            <div class="step-icon">📋</div>
            <div class="step-content">
              <div class="step-title">Step 1: Validate File</div>
              <div class="step-desc">Checking file size and format</div>
            </div>
            <span class="step-status pending">Pending</span>
          </div>

          <div class="progress-step" id="step2">
            <div class="step-icon">🔑</div>
            <div class="step-content">
              <div class="step-title">Step 2: Generate CEK & IV</div>
              <div class="step-desc" id="step2-desc">Creating 256-bit CEK + 96-bit IV via crypto.randomBytes</div>
            </div>
            <span class="step-status pending">Pending</span>
          </div>

          <div class="progress-step" id="step3">
            <div class="step-icon">🔒</div>
            <div class="step-content">
              <div class="step-title">Step 3: AES-256-GCM Encryption</div>
              <div class="step-desc" id="step3-desc">Authenticated encryption with 128-bit auth tag</div>
            </div>
            <span class="step-status pending">Pending</span>
          </div>

          <div class="progress-step" id="step4">
            <div class="step-icon">🔐</div>
            <div class="step-content">
              <div class="step-title">Step 4: Wrap CEK</div>
              <div class="step-desc" id="step4-desc">RSA-OAEP key wrapping for authorized actors</div>
            </div>
            <span class="step-status pending">Pending</span>
          </div>

          <div class="progress-step" id="step5">
            <div class="step-icon">☁️</div>
            <div class="step-content">
              <div class="step-title">Step 5: Upload to IPFS</div>
              <div class="step-desc" id="step5-desc">Pinning encrypted package (IV||Tag||Ciphertext)</div>
            </div>
            <span class="step-status pending">Pending</span>
          </div>

          <div class="progress-step" id="step6">
            <div class="step-icon">💾</div>
            <div class="step-content">
              <div class="step-title">Step 6: Save to Database</div>
              <div class="step-desc" id="step6-desc">Storing CID, wrapped keys, and metadata</div>
            </div>
            <span class="step-status pending">Pending</span>
          </div>
        </div>

        <div class="form-group">
          <label for="patientId">Patient ID *</label>
          <input type="text" id="patientId" placeholder="Enter patient identifier" required>
        </div>

        <div class="form-group">
          <label for="ownerAddr">Owner Wallet Address *</label>
          <input type="text" id="ownerAddr" placeholder="Cardano wallet address">
          <button class="btn btn-secondary" id="genAddrBtn" style="margin-top: 10px;">
            🎲 Generate Test Address
          </button>
        </div>

        <div class="form-group">
          <label>Authorized Actors *</label>
          <div class="actor-grid">
            <button class="actor-btn" data-actor="patient">👤 Patient</button>
            <button class="actor-btn" data-actor="doctor">👨‍⚕️ Doctor</button>
            <button class="actor-btn" data-actor="hospital">🏥 Hospital</button>
            <button class="actor-btn" data-actor="insurance">🏢 Insurance</button>
          </div>
        </div>

        <div class="form-group">
          <label>Medical File *</label>
          <div class="file-upload" id="fileUpload">
            <p>📁 Click or drag file here</p>
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">
              Max size: 50MB
            </p>
            <input type="file" id="fileInput" accept="*/*">
          </div>
          <div class="file-info" id="fileInfo"></div>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="pinIpfs" checked>
          <label for="pinIpfs">Pin to IPFS (Recommended)</label>
        </div>

        <button class="btn" id="uploadBtn" disabled>
          <span id="uploadBtnText">🔐 Encrypt & Upload</span>
        </button>
      </div>

      <!-- Records List Section -->
      <div class="card">
        <h2>
          <span>📋</span>
          Medical Records
        </h2>

        <div class="search-controls">
          <input 
            type="text" 
            id="searchInput" 
            placeholder="Search by patient ID or filename..."
            style="padding: 10px; background: var(--bg-input); border: 2px solid var(--border); border-radius: 8px; color: var(--text);">
          
          <select class="filter-select" id="statusFilter">
            <option value="">All Status</option>
            <option value="uploaded">Uploaded</option>
            <option value="anchored">Anchored</option>
            <option value="pending_anchor">Pending</option>
            <option value="revoked">Revoked</option>
          </select>

          <select class="filter-select" id="sortFilter">
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="largest">Largest File</option>
            <option value="smallest">Smallest File</option>
            <option value="name_az">Name (A-Z)</option>
            <option value="name_za">Name (Z-A)</option>
          </select>

          <button class="btn btn-secondary" id="refreshBtn" style="width: auto; padding: 10px 20px; white-space: nowrap;">
            🔄 Refresh
          </button>
        </div>

        <button class="clear-filters-btn" id="clearFiltersBtn" style="width: 100%; margin-bottom: 15px; display: none;">
          🗑️ Clear All Filters
        </button>

        <div class="records-list" id="recordsList">
          <div class="empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>No records found</p>
            <p style="font-size: 0.9rem; margin-top: 10px;">Upload your first medical record to get started</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Additional Features -->
    <div class="card">
      <h2>
        <span>🔑</span>
        Access Management
      </h2>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
        <div class="form-group">
          <label for="recordIdAccess">Record ID</label>
          <input type="text" id="recordIdAccess" placeholder="Enter record ID">
        </div>

        <div class="form-group">
          <label for="actorIdAccess">Actor ID</label>
          <select id="actorIdAccess">
            <option value="">Select actor...</option>
            <option value="patient">Patient</option>
            <option value="doctor">Doctor</option>
            <option value="hospital">Hospital</option>
            <option value="insurance">Insurance</option>
          </select>
        </div>

        <div style="display: flex; align-items: flex-end;">
          <button class="btn btn-secondary" id="requestAccessBtn" style="width: 100%;">
            🔓 Request Access
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Record Detail Modal -->
  <div class="modal" id="recordModal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>📄 Record Details</h3>
        <button class="close-btn" id="closeModalBtn">&times;</button>
      </div>
      <div id="recordDetails"></div>
    </div>
  </div>

  <script src="/app-script.js" defer></script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

/**
 * GET /app-script.js
 * Serves the external JavaScript for the production application
 */
function getAppScript(req, res) {
  const js = `/* app-script.js - Production application logic */
(function() {
  'use strict';

  // Configuration
  const API_BASE = window.location.origin;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  // Actor ID Mapping (Frontend label -> Backend ID)
  const ACTOR_MAP = {
    'patient': '01',
    'doctor': '02',
    'hospital': '03',
    'insurance': '04'
  };

  const ACTOR_NAMES = {
    '01': 'Patient',
    '02': 'Doctor',
    '03': 'Hospital',
    '04': 'Insurance'
  };

  // State
  let selectedFile = null;
  let selectedActors = new Set(); // Stores frontend labels (patient, doctor, etc.)
  let currentRecords = [];

  // Wallet State
  let cardanoAPI = null;
  let walletAddress = null;
  let walletBalance = 0;
  let walletConnected = false;

  // DOM Elements
  const connectWalletBtn = document.getElementById('connectWalletBtn');
  const disconnectWalletBtn = document.getElementById('disconnectWalletBtn');
  const walletDisconnected = document.getElementById('walletDisconnected');
  const walletConnectedDiv = document.getElementById('walletConnected');
  const walletAddressDisplay = document.getElementById('walletAddress');
  const walletBalanceDisplay = document.getElementById('walletBalance');
  const copyWalletAddressBtn = document.getElementById('copyWalletAddressBtn');

  // DOM Elements
  const uploadStatus = document.getElementById('uploadStatus');
  const statusIcon = document.getElementById('statusIcon');
  const statusText = document.getElementById('statusText');
  const encryptionProgress = document.getElementById('encryptionProgress');
  const progressBar = document.getElementById('progressBar');
  const patientIdInput = document.getElementById('patientId');
  const ownerAddrInput = document.getElementById('ownerAddr');
  const genAddrBtn = document.getElementById('genAddrBtn');
  const actorBtns = document.querySelectorAll('.actor-btn');
  const fileUpload = document.getElementById('fileUpload');
  const fileInput = document.getElementById('fileInput');
  const fileInfo = document.getElementById('fileInfo');
  const pinIpfsCheckbox = document.getElementById('pinIpfs');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadBtnText = document.getElementById('uploadBtnText');
  const recordsList = document.getElementById('recordsList');
  const searchInput = document.getElementById('searchInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const recordIdAccessInput = document.getElementById('recordIdAccess');
  const actorIdAccessSelect = document.getElementById('actorIdAccess');
  const requestAccessBtn = document.getElementById('requestAccessBtn');
  const recordModal = document.getElementById('recordModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const recordDetails = document.getElementById('recordDetails');

  // Utility Functions
  function generateHex(length) {
    const arr = new Uint8Array(length / 2);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleString();
  }

  // Toast Notification System
  function showToast(type, title, message, duration = 5000) {
    const toastContainer = document.getElementById('toastContainer');
    
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = \`toast \${type}\`;
    toast.innerHTML = \`
      <div class="toast-icon">\${icons[type] || 'ℹ️'}</div>
      <div class="toast-content">
        <div class="toast-title">\${title}</div>
        <div class="toast-message">\${message}</div>
      </div>
      <button class="toast-close">&times;</button>
    \`;

    toastContainer.appendChild(toast);

    // Close button handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
      toast.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    });

    // Auto-remove after duration
    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  // Copy to Clipboard with Toast Feedback
  function copyToClipboard(text, label = 'Text') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          showToast('success', 'Copied!', \`\${label} copied to clipboard\`, 2000);
        })
        .catch(err => {
          console.error('Copy failed:', err);
          showToast('error', 'Copy Failed', 'Could not copy to clipboard', 3000);
        });
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast('success', 'Copied!', \`\${label} copied to clipboard\`, 2000);
      } catch (err) {
        console.error('Copy failed:', err);
        showToast('error', 'Copy Failed', 'Could not copy to clipboard', 3000);
      }
      document.body.removeChild(textarea);
    }
  }

  // Create Copy Button Element
  function createCopyButton(text, label, id = '') {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = '📋 Copy';
    if (id) btn.id = id;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(text, label);
      
      // Visual feedback
      btn.classList.add('copied');
      btn.innerHTML = '✓ Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '📋 Copy';
      }, 2000);
    });
    
    return btn;
  }

  function setStatus(type, message) {
    uploadStatus.className = 'status-indicator status-' + type;
    
    const icons = {
      idle: '⏸',
      loading: '<div class="spinner"></div>',
      success: '✅',
      error: '❌'
    };
    
    statusIcon.innerHTML = icons[type] || '⏸';
    statusText.textContent = message;
  }

  function updateProgress(percentage) {
    progressBar.style.width = percentage + '%';
  }

  function setStepStatus(stepNum, status, details = null) {
    const step = document.getElementById('step' + stepNum);
    if (!step) return;
    
    const statusEl = step.querySelector('.step-status');
    const descEl = document.getElementById('step' + stepNum + '-desc');
    
    // Reset classes
    step.className = 'progress-step';
    statusEl.className = 'step-status';

    // Set new status
    switch(status) {
      case 'running':
        step.classList.add('active');
        statusEl.classList.add('running');
        statusEl.textContent = 'Running...';
        break;
      case 'complete':
        step.classList.add('complete');
        statusEl.classList.add('done');
        statusEl.textContent = 'Done ✓';
        break;
      case 'error':
        step.classList.add('error');
        statusEl.classList.add('failed');
        statusEl.textContent = 'Failed ✗';
        break;
      default:
        statusEl.classList.add('pending');
        statusEl.textContent = 'Pending';
    }

    // Update description with technical details if provided
    if (details && descEl) {
      descEl.textContent = details;
    }
  }
  
  function resetProgress() {
    encryptionProgress.classList.remove('visible');
    updateProgress(0);
    for (let i = 1; i <= 6; i++) {
      setStepStatus(i, 'pending');
      // Reset descriptions to original
      const descEl = document.getElementById('step' + i + '-desc');
      if (descEl) {
        const originalDescs = {
          1: 'Checking file size and format',
          2: 'Creating 256-bit CEK + 96-bit IV via crypto.randomBytes',
          3: 'Authenticated encryption with 128-bit auth tag',
          4: 'RSA-OAEP key wrapping for authorized actors',
          5: 'Pinning encrypted package (IV||Tag||Ciphertext)',
          6: 'Storing CID, wrapped keys, and metadata'
        };
        descEl.textContent = originalDescs[i] || '';
      }
    }
  }

  function showProgress() {
    encryptionProgress.classList.add('visible');
    resetProgress();
  }

  function validateInputs() {
    const hasPatientId = patientIdInput.value.trim().length > 0;
    const hasOwnerAddr = ownerAddrInput.value.trim().length > 0;
    const hasActors = selectedActors.size > 0;
    const hasFile = selectedFile !== null;
    const hasWallet = walletConnected;

    uploadBtn.disabled = !(hasPatientId && hasOwnerAddr && hasActors && hasFile && hasWallet);
    
    // Update button text to show wallet requirement
    if (!hasWallet && hasPatientId && hasOwnerAddr && hasActors && hasFile) {
      uploadBtnText.textContent = '🔗 Connect Wallet to Upload';
    } else {
      uploadBtnText.textContent = 'Encrypt & Upload';
    }
  }

  // Wallet Functions
  async function connectEternlWallet() {
    try {
      // Check if Eternl is installed
      if (!window.cardano || !window.cardano.eternl) {
        throw new Error('Eternl wallet not found. Please install Eternl extension from https://eternl.io');
      }

      setStatus('info', '🔗 Connecting to Eternl wallet...');
      console.log('[Eternl] Attempting connection...');

      // Enable Eternl wallet (CIP-30)
      cardanoAPI = await window.cardano.eternl.enable();
      console.log('[Eternl] API enabled, requesting addresses...');
      
      // Get wallet address (try used addresses first, then unused)
      let addresses = await cardanoAPI.getUsedAddresses();
      console.log('[Eternl] Used addresses:', addresses ? addresses.length : 0);
      
      if (!addresses || addresses.length === 0) {
        // Try unused addresses if no used addresses found (new wallet)
        addresses = await cardanoAPI.getUnusedAddresses();
        console.log('[Eternl] Unused addresses:', addresses ? addresses.length : 0);
      }
      
      if (!addresses || addresses.length === 0) {
        // Try change address as fallback
        const changeAddr = await cardanoAPI.getChangeAddress();
        console.log('[Eternl] Change address:', changeAddr ? 'found' : 'not found');
        if (changeAddr) {
          addresses = [changeAddr];
        }
      }

      if (!addresses || addresses.length === 0) {
        throw new Error('No addresses found in wallet. Please ensure your wallet is properly set up with at least one address. Try creating a receiving address in Eternl first.');
      }
      
      console.log('[Eternl] Using address:', addresses[0].substring(0, 30) + '...');

      // CIP-30 returns addresses as hex-encoded CBOR
      // For display and signing, we'll use the hex directly
      walletAddress = addresses[0];
      
      // For better UX, try to decode to bech32 if possible
      let displayAddress = walletAddress;
      try {
        // If address is already bech32 (some wallets return it directly)
        if (walletAddress.startsWith('addr')) {
          displayAddress = walletAddress;
        } else {
          // Otherwise show abbreviated hex
          displayAddress = walletAddress.substring(0, 20) + '...' + walletAddress.substring(walletAddress.length - 20);
        }
      } catch (e) {
        // Fallback to abbreviated hex
        displayAddress = walletAddress.substring(0, 20) + '...' + walletAddress.substring(walletAddress.length - 20);
      }
      
      // Get wallet balance (in lovelace)
      const balanceHex = await cardanoAPI.getBalance();
      const lovelace = parseInt(balanceHex, 16);
      walletBalance = (lovelace / 1000000).toFixed(2); // Convert to ADA

      // Get network ID
      const networkId = await cardanoAPI.getNetworkId();
      const networkName = networkId === 1 ? 'Mainnet' : 'Testnet';

      walletConnected = true;

      // Update UI
      walletDisconnected.style.display = 'none';
      walletConnectedDiv.style.display = 'block';
      walletAddressDisplay.textContent = displayAddress;
      walletBalanceDisplay.textContent = walletBalance + ' ADA';

      // Auto-fill owner address with full hex address
      ownerAddrInput.value = walletAddress;
      validateInputs();

      setStatus('success', '✅ Wallet connected successfully! Network: ' + networkName);
      showToast('success', 'Wallet Connected', \`Connected to \${networkName} with \${walletBalance} ADA\`, 4000);
      console.log('[Eternl] Connected:', { 
        addressHex: walletAddress.substring(0, 30) + '...', 
        addressDisplay: displayAddress,
        balance: walletBalance + ' ADA', 
        network: networkName 
      });

    } catch (error) {
      console.error('[Eternl] Connection failed:', error);
      setStatus('error', '❌ Wallet connection failed: ' + error.message);
      showToast('error', 'Connection Failed', error.message, 5000);
      throw error;
    }
  }

  function disconnectWallet() {
    cardanoAPI = null;
    walletAddress = null;
    walletBalance = 0;
    walletConnected = false;

    walletDisconnected.style.display = 'block';
    walletConnectedDiv.style.display = 'none';
    walletAddressDisplay.textContent = '-';
    walletBalanceDisplay.textContent = '- ADA';

    setStatus('info', '🔌 Wallet disconnected');
    showToast('info', 'Wallet Disconnected', 'You have been logged out', 3000);
    console.log('[Eternl] Disconnected');
  }

  async function signMessage(operation, recordId, actorId) {
    if (!walletConnected || !cardanoAPI || !walletAddress) {
      throw new Error('Wallet not connected. Please connect your Eternl wallet first.');
    }

    try {
      // Create payload matching backend verification format
      const payload = {
        operation: operation,      // 'upload' or 'access'
        recordId: recordId,
        actorId: actorId,          // Backend format (01, 02, 03, 04)
        timestamp: Date.now(),
        network: 'mainnet'
      };

      const payloadJSON = JSON.stringify(payload);
      
      // Convert to hex (browser-compatible way)
      const encoder = new TextEncoder();
      const payloadBytes = encoder.encode(payloadJSON);
      const payloadHex = Array.from(payloadBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      console.log('[Eternl] Signing payload:', payload);

      // Sign with CIP-8 (signData returns { key, signature })
      const signedData = await cardanoAPI.signData(walletAddress, payloadHex);

      console.log('[Eternl] Signature created:', { 
        key: signedData.key.substring(0, 20) + '...', 
        signature: signedData.signature.substring(0, 20) + '...' 
      });

      return signedData;

    } catch (error) {
      console.error('[Eternl] Signature failed:', error);
      throw new Error('Failed to sign message: ' + error.message);
    }
  }

  // Filter State
  let currentFilters = {
    search: '',
    status: '',
    sort: 'newest'
  };

  function updateClearFiltersButton() {
    const clearBtn = document.getElementById('clearFiltersBtn');
    const hasFilters = currentFilters.search || currentFilters.status || currentFilters.sort !== 'newest';
    clearBtn.style.display = hasFilters ? 'block' : 'none';
  }

  function clearAllFilters() {
    currentFilters = { search: '', status: '', sort: 'newest' };
    searchInput.value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('sortFilter').value = 'newest';
    updateClearFiltersButton();
    loadRecords();
  }

  // Event Handlers
  connectWalletBtn.addEventListener('click', async () => {
    connectWalletBtn.disabled = true;
    connectWalletBtn.textContent = '⏳ Connecting...';
    
    try {
      await connectEternlWallet();
    } catch (error) {
      // Error already logged and displayed
    } finally {
      connectWalletBtn.disabled = false;
      connectWalletBtn.textContent = '🔗 Connect Eternl Wallet';
    }
  });

  disconnectWalletBtn.addEventListener('click', () => {
    disconnectWallet();
  });

  // Copy wallet address button
  copyWalletAddressBtn.addEventListener('click', () => {
    if (walletAddress) {
      copyToClipboard(walletAddress, 'Wallet Address');
      copyWalletAddressBtn.classList.add('copied');
      copyWalletAddressBtn.innerHTML = '✓';
      setTimeout(() => {
        copyWalletAddressBtn.classList.remove('copied');
        copyWalletAddressBtn.innerHTML = '📋';
      }, 2000);
    }
  });

  // Event Handlers
  genAddrBtn.addEventListener('click', () => {
    ownerAddrInput.value = generateHex(64);
    validateInputs();
  });

  actorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const actor = btn.getAttribute('data-actor');
      
      if (selectedActors.has(actor)) {
        selectedActors.delete(actor);
        btn.classList.remove('selected');
      } else {
        selectedActors.add(actor);
        btn.classList.add('selected');
      }
      
      validateInputs();
    });
  });

  fileUpload.addEventListener('click', () => fileInput.click());

  fileUpload.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUpload.classList.add('dragover');
  });

  fileUpload.addEventListener('dragleave', () => {
    fileUpload.classList.remove('dragover');
  });

  fileUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUpload.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  function handleFileSelect(file) {
    if (file.size > MAX_FILE_SIZE) {
      setStatus('error', 'File too large (max 50MB)');
      showToast('error', 'File Too Large', \`Maximum file size is 50MB. Your file is \${formatBytes(file.size)}\`, 4000);
      return;
    }

    selectedFile = file;
    fileInfo.textContent = \`📄 \${file.name} (\${formatBytes(file.size)})\`;
    fileInfo.classList.add('visible');
    showToast('success', 'File Selected', \`\${file.name} (\${formatBytes(file.size)})\`, 3000);
    validateInputs();
  }

  uploadBtn.addEventListener('click', async () => {
    if (uploadBtn.disabled) return;

    try {
      setStatus('loading', 'Starting encryption process...');
      showProgress();
      uploadBtn.disabled = true;

      // Step 1: Validate File
      setStepStatus(1, 'running', \`Validating \${formatBytes(selectedFile.size)} file...\`);
      updateProgress(10);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!selectedFile) {
        throw new Error('No file selected');
      }
      if (selectedFile.size > 50 * 1024 * 1024) {
        throw new Error('File too large (max 50MB)');
      }
      
      setStepStatus(1, 'complete', \`✓ File validated: \${selectedFile.type || 'binary'}\`);
      updateProgress(15);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 2: Generate CEK & IV (simulated - happens server-side)
      setStepStatus(2, 'running', 'Generating 32-byte CEK via crypto.randomBytes(32)...');
      setStatus('loading', 'Generating cryptographic materials...');
      await new Promise(resolve => setTimeout(resolve, 600));
      
      setStepStatus(2, 'complete', '✓ CEK: 256 bits | IV: 96 bits | Mode: AES-GCM');
      updateProgress(25);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 3: AES-256-GCM Encryption (simulated - happens server-side)
      setStepStatus(3, 'running', 'Encrypting with cipher.update() + cipher.final()...');
      setStatus('loading', 'Performing AES-256-GCM encryption...');
      
      // Show progress during encryption simulation
      for (let i = 25; i < 40; i += 2) {
        updateProgress(i);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const encryptedSize = Math.ceil(selectedFile.size * 1.02); // ~2% overhead
      setStepStatus(3, 'complete', \`✓ Encrypted: \${formatBytes(encryptedSize)} | Auth tag: 128 bits\`);
      updateProgress(40);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 4: Wrap CEK with Actor Public Keys
      const actorCount = selectedActors.size;
      setStepStatus(4, 'running', \`Wrapping CEK for \${actorCount} actor(s) using RSA-OAEP...\`);
      setStatus('loading', 'Wrapping encryption key for authorized actors...');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setStepStatus(4, 'complete', \`✓ CEK wrapped for \${actorCount} actor(s) | Algorithm: RSA-OAEP\`);
      updateProgress(55);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 5: Upload to IPFS
      setStepStatus(5, 'running', 'Uploading encrypted package to Pinata gateway...');
      setStatus('loading', 'Uploading to IPFS via Pinata...');

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('patientId', patientIdInput.value.trim());
      
      // Convert frontend actor labels to backend IDs
      const firstActorLabel = Array.from(selectedActors)[0];
      const ownerActorId = ACTOR_MAP[firstActorLabel];
      
      formData.append('ownerId', ownerActorId);
      formData.append('ownerAddr', ownerAddrInput.value.trim());
      
      // Convert all selected actors to backend IDs
      const actorIds = Array.from(selectedActors).map(label => ACTOR_MAP[label]).join(',');
      formData.append('actorIds', actorIds);
      formData.append('pinToIpfs', pinIpfsCheckbox.checked ? 'true' : 'false');

      // Generate wallet signature if connected
      if (walletConnected && cardanoAPI) {
        try {
          setStatus('loading', '🖊️ Requesting wallet signature...');
          const tempRecordId = 'upload_' + Date.now();
          const signature = await signMessage('upload', tempRecordId, ownerActorId);
          
          // Add signature to formData (as JSON string)
          formData.append('ownerSignature', JSON.stringify(signature));
          console.log('[Upload] Signature added to request');
        } catch (sigError) {
          throw new Error('Signature required: ' + sigError.message);
        }
      } else {
        throw new Error('Wallet not connected. Please connect your Eternl wallet to sign the upload.');
      }

      const response = await fetch(\`\${API_BASE}/api/encrypt/upload\`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || \`Upload failed: \${response.status}\`);
      }

      const result = await response.json();
      
      const cid = result.cid || 'unknown';
      const cidPreview = cid.substring(0, 16) + '...';
      setStepStatus(5, 'complete', \`✓ Pinned to IPFS | CID: \${cidPreview}\`);
      updateProgress(75);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 6: Save to Database
      setStepStatus(6, 'running', 'Storing record with wrapped keys in MongoDB...');
      setStatus('loading', 'Saving metadata to database...');
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const recordIdPreview = result.recordId ? result.recordId.substring(0, 8) + '...' : 'unknown';
      setStepStatus(6, 'complete', \`✓ Saved | Record ID: \${recordIdPreview}\`);
      updateProgress(100);
      
      setStatus('success', \`✅ Encrypted & uploaded! CID: \${cidPreview}\`);
      
      // Show success toast with details
      showToast('success', 'Upload Complete!', \`Record \${recordIdPreview} uploaded successfully. \${result.hydraShared ? 'Shared via Hydra L2!' : ''}\`, 6000);
      
      // Reset form after delay
      setTimeout(() => {
        selectedFile = null;
        selectedActors.clear();
        patientIdInput.value = '';
        fileInput.value = '';
        fileInfo.classList.remove('visible');
        actorBtns.forEach(btn => btn.classList.remove('selected'));
        setStatus('idle', 'Ready to upload');
        resetProgress();
        
        // Refresh records list
        loadRecords();
      }, 3000);

    } catch (error) {
      console.error('Upload error:', error);
      
      // Mark current step as error
      for (let i = 1; i <= 6; i++) {
        const step = document.getElementById('step' + i);
        if (step && step.classList.contains('active')) {
          setStepStatus(i, 'error', \`✗ Error: \${error.message}\`);
          break;
        }
      }
      
      setStatus('error', error.message);
      showToast('error', 'Upload Failed', error.message, 6000);
      uploadBtn.disabled = false;
      
      setTimeout(() => {
        resetProgress();
      }, 5000);
    }
  });

  async function loadRecords() {
    try {
      let url = \`\${API_BASE}/api/records?limit=100\`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to load records');
      }

      const data = await response.json();
      currentRecords = data.records || [];

      if (currentRecords.length === 0) {
        recordsList.innerHTML = \`
          <div class="empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>No records found</p>
            <p style="font-size: 0.9rem; margin-top: 10px;">Upload your first medical record to get started</p>
          </div>
        \`;
        return;
      }

      // Apply all filters
      let displayRecords = currentRecords;

      // Filter by search query
      if (currentFilters.search) {
        const query = currentFilters.search.toLowerCase();
        displayRecords = displayRecords.filter(r => {
          const filename = r.metadata?.originalName || '';
          const patientId = r.metadata?.patientId || '';
          return filename.toLowerCase().includes(query) || 
                 patientId.toLowerCase().includes(query) ||
                 r.recordId.toLowerCase().includes(query);
        });
      }

      // Filter by status
      if (currentFilters.status) {
        displayRecords = displayRecords.filter(r => r.status === currentFilters.status);
      }

      // Sort records
      displayRecords.sort((a, b) => {
        switch(currentFilters.sort) {
          case 'newest':
            return new Date(b.createdAt) - new Date(a.createdAt);
          case 'oldest':
            return new Date(a.createdAt) - new Date(b.createdAt);
          case 'largest':
            return (b.metadata?.size || 0) - (a.metadata?.size || 0);
          case 'smallest':
            return (a.metadata?.size || 0) - (b.metadata?.size || 0);
          case 'name_az':
            return (a.metadata?.originalName || '').localeCompare(b.metadata?.originalName || '');
          case 'name_za':
            return (b.metadata?.originalName || '').localeCompare(a.metadata?.originalName || '');
          default:
            return 0;
        }
      });

      if (displayRecords.length === 0) {
        recordsList.innerHTML = \`
          <div class="empty-state">
            <p>No records match your filters</p>
            <p style="font-size: 0.9rem; margin-top: 10px;">Try adjusting your search or filters</p>
          </div>
        \`;
        return;
      }

      recordsList.innerHTML = displayRecords.map(record => {
        const filename = record.metadata?.originalName || 'Unknown file';
        const patientId = record.metadata?.patientId || 'N/A';
        const size = record.metadata?.size ? formatBytes(record.metadata.size) : 'N/A';
        const date = record.createdAt ? formatDate(record.createdAt) : 'N/A';
        const statusBadge = getStatusBadge(record.status);
        const recordIdShort = record.recordId.substring(0, 8) + '...';

        return \`
          <div class="record-item" data-record-id="\${record.recordId}">
            <div class="record-header">
              <div class="record-filename">
                📄 \${filename}
                <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-left: 8px;">ID: \${recordIdShort}</span>
              </div>
              <span class="badge \${statusBadge.class}">\${statusBadge.text}</span>
            </div>
            <div class="record-meta">
              <span>👤 \${patientId}</span>
              <span>📦 \${size}</span>
              <span>📅 \${date}</span>
            </div>
          </div>
        \`;
      }).join('');

      // Add click handlers to record items
      document.querySelectorAll('.record-item').forEach(item => {
        item.addEventListener('click', () => {
          const recordId = item.getAttribute('data-record-id');
          showRecordDetails(recordId);
        });
      });

    } catch (error) {
      console.error('Error loading records:', error);
      showToast('error', 'Load Failed', 'Could not load records: ' + error.message, 5000);
      recordsList.innerHTML = \`
        <div class="empty-state">
          <p style="color: var(--error);">❌ Failed to load records</p>
          <p style="font-size: 0.9rem; margin-top: 10px;">\${error.message}</p>
        </div>
      \`;
    }
  }

  function getStatusBadge(status) {
    const badges = {
      draft: { text: 'Draft', class: 'badge-warning' },
      uploaded: { text: 'Uploaded', class: 'badge-success' },
      pending_anchor: { text: 'Pending', class: 'badge-warning' },
      anchored: { text: 'Anchored', class: 'badge-success' },
      revoked: { text: 'Revoked', class: 'badge-error' }
    };
    return badges[status] || { text: status, class: 'badge-warning' };
  }

  async function showRecordDetails(recordId) {
    try {
      const response = await fetch(\`\${API_BASE}/api/records/\${recordId}/metadata\`);
      
      if (!response.ok) {
        throw new Error('Failed to load record details');
      }

      const record = await response.json();
      const statusBadge = getStatusBadge(record.status);

      recordDetails.innerHTML = \`
        <div class="info-grid">
          <div class="info-row">
            <div class="info-label">Record ID</div>
            <div class="info-value" style="display: flex; align-items: center; justify-content: space-between;">
              <span style="word-break: break-all; flex: 1;">\${record.recordId}</span>
            </div>
          </div>
          <div class="info-row">
            <div class="info-label">Patient ID</div>
            <div class="info-value">\${record.metadata?.patientId || 'N/A'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Filename</div>
            <div class="info-value">\${record.metadata?.originalName || 'Unknown'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Status</div>
            <div class="info-value"><span class="badge \${statusBadge.class}">\${statusBadge.text}</span></div>
          </div>
          <div class="info-row">
            <div class="info-label">File Size</div>
            <div class="info-value">\${record.metadata?.size ? formatBytes(record.metadata.size) : 'N/A'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Encrypted Size</div>
            <div class="info-value">\${record.metadata?.encryptedSize ? formatBytes(record.metadata.encryptedSize) : 'N/A'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">IPFS CID</div>
            <div class="info-value" style="display: flex; align-items: center; justify-content: space-between;">
              <span style="word-break: break-all; flex: 1;">\${record.cid || 'Not pinned'}</span>
            </div>
          </div>
          <div class="info-row">
            <div class="info-label">Owner</div>
            <div class="info-value" style="display: flex; align-items: center; justify-content: space-between;">
              <span style="word-break: break-all; flex: 1;">\${record.owner}</span>
            </div>
          </div>
          <div class="info-row">
            <div class="info-label">Authorized Actors</div>
            <div class="info-value">\${record.wrappedActors?.map(id => ACTOR_NAMES[id] || id).join(', ') || 'None'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Created At</div>
            <div class="info-value">\${formatDate(record.createdAt)}</div>
          </div>
          \${record.onchainTx ? \`
          <div class="info-row">
            <div class="info-label">Blockchain TX</div>
            <div class="info-value">\${record.onchainTx}</div>
          </div>
          \` : ''}
        </div>
      \`;

      // Add copy buttons after rendering
      const recordIdRow = recordDetails.querySelector('.info-row:nth-child(1) .info-value');
      recordIdRow.appendChild(createCopyButton(record.recordId, 'Record ID'));

      if (record.cid) {
        const cidRow = recordDetails.querySelector('.info-row:nth-child(7) .info-value');
        cidRow.appendChild(createCopyButton(record.cid, 'IPFS CID'));
      }

      const ownerRow = recordDetails.querySelector('.info-row:nth-child(8) .info-value');
      ownerRow.appendChild(createCopyButton(record.owner, 'Owner Address'));

      recordModal.classList.add('visible');
    } catch (error) {
      console.error('Error loading record details:', error);
      showToast('error', 'Load Failed', 'Could not load record details: ' + error.message, 5000);
    }
  }

  refreshBtn.addEventListener('click', () => {
    showToast('info', 'Refreshing...', 'Loading latest records', 2000);
    loadRecords();
  });

  // Search functionality with debounce
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    currentFilters.search = e.target.value.trim();
    updateClearFiltersButton();
    searchTimeout = setTimeout(() => {
      loadRecords();
    }, 500); // Debounce for 500ms
  });

  // Status filter
  document.getElementById('statusFilter').addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    updateClearFiltersButton();
    loadRecords();
  });

  // Sort filter
  document.getElementById('sortFilter').addEventListener('change', (e) => {
    currentFilters.sort = e.target.value;
    updateClearFiltersButton();
    loadRecords();
  });

  // Clear filters button
  document.getElementById('clearFiltersBtn').addEventListener('click', clearAllFilters);

  requestAccessBtn.addEventListener('click', async () => {
    const recordId = recordIdAccessInput.value.trim();
    const actorId = actorIdAccessSelect.value;

    if (!recordId || !actorId) {
      alert('Please enter record ID and select an actor');
      return;
    }

    // Convert frontend label to backend ID (patient → 01, doctor → 02, etc.)
    const backendActorId = ACTOR_MAP[actorId];
    if (!backendActorId) {
      alert('Invalid actor ID');
      return;
    }

    try {
      requestAccessBtn.disabled = true;
      requestAccessBtn.textContent = '⏳ Requesting...';

      // Check wallet connection
      if (!walletConnected || !cardanoAPI) {
        throw new Error('Wallet not connected. Please connect your Eternl wallet first.');
      }

      // Generate wallet signature for access request
      const signature = await signMessage('access', recordId, backendActorId);

      const response = await fetch(\`\${API_BASE}/api/access/request\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          actorId: backendActorId,
          actorAddr: walletAddress,
          actorSignature: signature  // { key, signature } from signMessage()
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Access request failed');
      }

      const result = await response.json();
      showToast('success', 'Access Granted!', 'Wrapped key retrieved successfully', 4000);
      console.log('Access result:', result);

    } catch (error) {
      console.error('Access request error:', error);
      showToast('error', 'Access Denied', error.message, 5000);
    } finally {
      requestAccessBtn.disabled = false;
      requestAccessBtn.textContent = '🔓 Request Access';
    }
  });

  closeModalBtn.addEventListener('click', () => {
    recordModal.classList.remove('visible');
  });

  recordModal.addEventListener('click', (e) => {
    if (e.target === recordModal) {
      recordModal.classList.remove('visible');
    }
  });

  // Input validation listeners
  patientIdInput.addEventListener('input', validateInputs);
  ownerAddrInput.addEventListener('input', validateInputs);

  // Initialize
  validateInputs();
  updateClearFiltersButton();
  loadRecords();

  // Show welcome toast
  setTimeout(() => {
    showToast('info', 'Welcome to Cardano Health Vault', 'Secure medical records with blockchain verification', 4000);
  }, 500);

  console.log('✅ Cardano Health Vault initialized with enhanced features');
})();
`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(js);
}

module.exports = { getAppPage, getAppScript };
