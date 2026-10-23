const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const auth = require('../services/authService');
const { logAudit } = require('../services/auditLogger');

const router = express.Router();

// Brute-force guard: 10 attempts per IP per 15 minutes; successful logins don't count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

router.get('/login', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../../public/login.html'));
});

router.get('/api/auth/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const session = auth.getSession(req);
  res.json({
    configured: auth.isConfigured(),
    demoLogin: demoLoginEnabled(),
    actors: session ? session.actors : [],
    expiresAt: session ? new Date(session.exp * 1000).toISOString() : null,
  });
});

router.post('/api/auth/login', loginLimiter, (req, res) => {
  if (!auth.isConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured on this server.' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Enter a username and password.' });
  }
  const actorId = auth.verifyPassword(username, password);
  if (!actorId) {
    logAudit('LOGIN_FAILED', { username: username.slice(0, 32).toLowerCase(), ip: req.ip });
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  const existing = auth.getSession(req);
  const actors = Array.from(new Set([...(existing ? existing.actors : []), actorId])).sort();
  auth.setSessionCookie(req, res, actors);
  logAudit('LOGIN_SUCCESS', { actorId, ip: req.ip });
  res.json({ actorId, name: auth.ACTOR_NAMES[actorId], actors });
});

// One-click demo access for presentations. Only exists while the server runs
// in DEMO_MODE (and can be switched off with DEMO_LOGIN=false); no password
// ever reaches the browser, and every use is written to the audit log.
function demoLoginEnabled() {
  return process.env.DEMO_MODE === 'true' && process.env.DEMO_LOGIN !== 'false' && auth.isConfigured();
}

router.post('/api/auth/demo-login', loginLimiter, (req, res) => {
  if (!demoLoginEnabled()) return res.status(404).json({ error: 'Demo sign-in is not available.' });
  const { role } = req.body || {};
  const roles = role === 'all' ? Object.keys(auth.ROLES) : [String(role || '').toLowerCase()];
  if (!roles.every((r) => auth.ROLES[r])) return res.status(400).json({ error: 'Unknown role.' });
  const existing = auth.getSession(req);
  const added = roles.map((r) => auth.ROLES[r]);
  const actors = Array.from(new Set([...(existing ? existing.actors : []), ...added])).sort();
  auth.setSessionCookie(req, res, actors);
  logAudit('DEMO_LOGIN', { actorIds: added, ip: req.ip });
  res.json({ actors });
});

router.post('/api/auth/logout', (req, res) => {
  const existing = auth.getSession(req);
  const { actorId } = req.body || {};
  let actors = [];
  if (existing && actorId) actors = existing.actors.filter((a) => a !== String(actorId));
  auth.setSessionCookie(req, res, actors);
  if (existing) logAudit('LOGOUT', { actorIds: actorId ? [String(actorId)] : existing.actors, ip: req.ip });
  res.json({ actors });
});

module.exports = router;
