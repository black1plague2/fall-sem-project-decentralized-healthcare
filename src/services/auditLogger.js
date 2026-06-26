const winston = require('winston');
const path = require('path');

// Audit event types
const AUDIT_EVENTS = {
  ACCESS_GRANTED: 'ACCESS_GRANTED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  CEK_WRAPPED: 'CEK_WRAPPED',
  CEK_UNWRAPPED: 'CEK_UNWRAPPED',
  CEK_ROTATED: 'CEK_ROTATED',
  SIGNATURE_VERIFICATION_FAILED: 'SIGNATURE_VERIFICATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  ACTOR_REGISTERED: 'ACTOR_REGISTERED',
  ACTOR_DEACTIVATED: 'ACTOR_DEACTIVATED',
  FILE_UPLOADED: 'FILE_UPLOADED',
  PERMISSION_CHECK: 'PERMISSION_CHECK',
  REVOCATION: 'REVOCATION',
};

// Create Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'cardano-health-vault',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      ),
    }),
    // File output - general logs
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 30,
      tailable: true,
    }),
    // File output - audit logs only
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'audit.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 90, // 90-day retention for compliance
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
    // Error logs
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 90,
      tailable: true,
    }),
  ],
});

/**
 * Log an audit event
 * @param {string} event - Event type from AUDIT_EVENTS
 * @param {Object} details - Event details
 */
function logAudit(event, details = {}) {
  const auditEntry = {
    event,
    timestamp: new Date().toISOString(),
    ...details,
  };
  
  logger.info('AUDIT', auditEntry);
}

/**
 * Log access granted event
 */
function logAccessGranted({ recordId, actorId, actorAddr, requestId }) {
  logAudit(AUDIT_EVENTS.ACCESS_GRANTED, {
    recordId,
    actorId,
    actorAddr,
    requestId,
  });
}

/**
 * Log access denied event
 */
function logAccessDenied({ recordId, actorId, actorAddr, reason, requestId }) {
  logAudit(AUDIT_EVENTS.ACCESS_DENIED, {
    recordId,
    actorId,
    actorAddr,
    reason,
    requestId,
  });
}

/**
 * Log CEK wrapped event
 */
function logCEKWrapped({ recordId, actorId, requestId }) {
  logAudit(AUDIT_EVENTS.CEK_WRAPPED, {
    recordId,
    actorId,
    requestId,
  });
}

/**
 * Log CEK unwrapped event
 */
function logCEKUnwrapped({ recordId, actorId, requestId }) {
  logAudit(AUDIT_EVENTS.CEK_UNWRAPPED, {
    recordId,
    actorId,
    requestId,
  });
}

/**
 * Log CEK rotation event
 */
function logCEKRotated({ recordId, revokedActorId, oldCID, newCID, requestId }) {
  logAudit(AUDIT_EVENTS.CEK_ROTATED, {
    recordId,
    revokedActorId,
    oldCID,
    newCID,
    requestId,
  });
}

/**
 * Log signature verification failure
 */
function logSignatureVerificationFailed({ operation, walletAddr, requestId, reason }) {
  logAudit(AUDIT_EVENTS.SIGNATURE_VERIFICATION_FAILED, {
    operation,
    walletAddr,
    requestId,
    reason,
  });
}

/**
 * Log rate limit exceeded
 */
function logRateLimitExceeded({ ip, endpoint, requestId }) {
  logAudit(AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, {
    ip,
    endpoint,
    requestId,
  });
}

/**
 * Log actor registration
 */
function logActorRegistered({ actorId, role, walletAddress, requestId }) {
  logAudit(AUDIT_EVENTS.ACTOR_REGISTERED, {
    actorId,
    role,
    walletAddress,
    requestId,
  });
}

/**
 * Log actor deactivation
 */
function logActorDeactivated({ actorId, requestId }) {
  logAudit(AUDIT_EVENTS.ACTOR_DEACTIVATED, {
    actorId,
    requestId,
  });
}

/**
 * Log file upload
 */
function logFileUploaded({ recordId, cid, cidHash, ownerAddr, requestId }) {
  logAudit(AUDIT_EVENTS.FILE_UPLOADED, {
    recordId,
    cid,
    cidHash,
    ownerAddr,
    requestId,
  });
}

/**
 * Log permission check
 */
function logPermissionCheck({ recordId, actorId, result, method, requestId }) {
  logAudit(AUDIT_EVENTS.PERMISSION_CHECK, {
    recordId,
    actorId,
    result,
    method, // 'blockfrost', 'midnight', 'mock'
    requestId,
  });
}

/**
 * Log revocation event
 */
function logRevocation({ recordId, actorId, ownerAddr, rotationStatus, requestId }) {
  logAudit(AUDIT_EVENTS.REVOCATION, {
    recordId,
    actorId,
    ownerAddr,
    rotationStatus,
    requestId,
  });
}

/**
 * Generate request ID for correlation
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

module.exports = {
  logger,
  AUDIT_EVENTS,
  logAudit,
  logAccessGranted,
  logAccessDenied,
  logCEKWrapped,
  logCEKUnwrapped,
  logCEKRotated,
  logSignatureVerificationFailed,
  logRateLimitExceeded,
  logActorRegistered,
  logActorDeactivated,
  logFileUploaded,
  logPermissionCheck,
  logRevocation,
  generateRequestId,
};
