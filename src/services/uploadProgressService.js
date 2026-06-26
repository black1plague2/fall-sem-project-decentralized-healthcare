const crypto = require('crypto');

// In-memory store for active upload sessions
const uploadSessions = new Map();

/**
 * Create a new upload session
 * @param {string} sessionId - Unique session identifier
 * @returns {object} Session object with methods to send updates
 */
function createSession(sessionId) {
  const session = {
    id: sessionId,
    clients: [],
    status: 'pending',
    progress: 0,
    step: 0,
    details: '',
    startTime: Date.now()
  };
  
  uploadSessions.set(sessionId, session);
  return session;
}

/**
 * Add a client to a session
 * @param {string} sessionId - Session ID
 * @param {object} res - Express response object
 */
function addClient(sessionId, res) {
  const session = uploadSessions.get(sessionId);
  if (!session) {
    return false;
  }
  
  session.clients.push(res);
  
  // Send current state immediately
  sendUpdate(sessionId, {
    step: session.step,
    progress: session.progress,
    status: session.status,
    details: session.details
  });
  
  return true;
}

/**
 * Send progress update to all connected clients
 * @param {string} sessionId - Session ID
 * @param {object} data - Update data
 */
function sendUpdate(sessionId, data) {
  const session = uploadSessions.get(sessionId);
  if (!session) return;
  
  // Update session state
  Object.assign(session, data);
  
  // Send to all connected clients
  const message = JSON.stringify({
    sessionId,
    timestamp: Date.now(),
    ...data
  });
  
  session.clients.forEach((client, index) => {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      // Remove dead client
      session.clients.splice(index, 1);
    }
  });
}

/**
 * Close a session and disconnect all clients
 * @param {string} sessionId - Session ID
 */
function closeSession(sessionId) {
  const session = uploadSessions.get(sessionId);
  if (!session) return;
  
  session.clients.forEach(client => {
    try {
      client.write('data: {"status":"complete"}\n\n');
      client.end();
    } catch (err) {
      // Ignore
    }
  });
  
  uploadSessions.delete(sessionId);
}

/**
 * Remove a client from a session
 * @param {string} sessionId - Session ID
 * @param {object} res - Express response object
 */
function removeClient(sessionId, res) {
  const session = uploadSessions.get(sessionId);
  if (!session) return;
  
  const index = session.clients.indexOf(res);
  if (index !== -1) {
    session.clients.splice(index, 1);
  }
  
  // Clean up empty sessions
  if (session.clients.length === 0) {
    setTimeout(() => {
      if (session.clients.length === 0) {
        uploadSessions.delete(sessionId);
      }
    }, 30000); // Clean up after 30 seconds of inactivity
  }
}

/**
 * Generate a unique session ID
 * @returns {string} Session ID
 */
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  createSession,
  addClient,
  removeClient,
  sendUpdate,
  closeSession,
  generateSessionId
};
