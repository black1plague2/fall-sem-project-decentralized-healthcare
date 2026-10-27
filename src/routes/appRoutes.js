const express = require('express');
const path = require('path');
const fs = require('fs');
const appController = require('../controllers/appController');
const { getSession } = require('../services/authService');

const router = express.Router();

// Serve the production application page
router.get('/app', appController.getAppPage);

// Serve the external JavaScript for the production application
router.get('/app-script.js', appController.getAppScript);

// Serve the enhanced demo visualization page
router.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/demo.html'));
});

// Each actor has its own portal: /portal/patient, /portal/doctor,
// /portal/hospital, /portal/insurance. A portal opens only for a browser
// signed in as that actor, and the page itself is locked to that actor;
// every API call it makes is checked against it on the server.
const PORTALS = {
  patient: { id: '01', name: 'Patient' },
  doctor: { id: '02', name: 'Doctor' },
  hospital: { id: '03', name: 'Hospital' },
  insurance: { id: '04', name: 'Insurance' },
};
let portalTemplate = null;
function portalHtml(role) {
  if (!portalTemplate) {
    portalTemplate = fs.readFileSync(path.join(__dirname, '../../public/dashboard.html'), 'utf8');
  }
  const p = PORTALS[role];
  return portalTemplate
    .replace('<title>Dashboard — Cardano Healthcare Vault</title>', `<title>${p.name} Portal — Decentralized Healthcare</title>`)
    .replace('<body>', `<body class="portal portal--${role}" data-role="${role}" data-actor="${p.id}">`);
}

router.get('/portal/:role', (req, res) => {
  const role = String(req.params.role || '').toLowerCase();
  if (!PORTALS[role]) return res.redirect('/login');
  const session = getSession(req);
  if (!session || !session.actors.includes(PORTALS[role].id)) {
    return res.redirect(`/login?role=${role}&next=/portal/${role}`);
  }
  res.set('Cache-Control', 'no-store');
  res.type('html').send(portalHtml(role));
});

// The old single dashboard now forwards to a portal: the Patient's if signed
// in, else the first signed-in actor's, else the portal chooser.
router.get('/dashboard', (req, res) => {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  const id = session.actors.includes('01') ? '01' : session.actors[0];
  const role = Object.keys(PORTALS).find((r) => PORTALS[r].id === id);
  res.redirect(`/portal/${role}`);
});

// Presenter mode: the four portals side by side and a narrated, end-to-end
// run of every feature. Static page; it signs each portal in on its own.
router.get('/present', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../../public/present.html'));
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
