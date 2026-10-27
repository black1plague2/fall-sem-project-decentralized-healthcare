// authService.js — actor sign-in for the dashboard and the API.
//
// Each of the four actors (Patient, Doctor, Hospital, Insurance) has a
// username and a password. Passwords are never stored: only scrypt hashes,
// supplied through the ACTOR_CREDENTIALS environment variable (generate them
// with `node scripts/setActorPasswords.js`).
//
// A successful sign-in sets an HttpOnly, SameSite=Strict cookie holding the
// list of actors signed in on this browser, signed with HMAC-SHA256 so it
// cannot be edited. It is stateless on purpose, so it works across Vercel's
// serverless instances as long as they share SESSION_SECRET.

const crypto = require('crypto');

const COOKIE = 'chv_session';
const SESSION_HOURS = 8;
const ON_VERCEL = Boolean(process.env.VERCEL);

const ROLES = {
  patient: '01',
  doctor: '02',
  hospital: '03',
  insurance: '04',
};
const ACTOR_NAMES = { '01': 'Patient', '02': 'Doctor', '03': 'Hospital', '04': 'Insurance' };

// ---------------------------------------------------------------------------
// Secrets and credentials
// ---------------------------------------------------------------------------
let localSecret = null;
function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    return process.env.SESSION_SECRET;
  }
  // Locally a per-process secret is fine (sessions just end on restart).
  // On Vercel every instance would invent a different one, so refuse.
  if (ON_VERCEL) return null;
  if (!localSecret) localSecret = crypto.randomBytes(32).toString('hex');
  return localSecret;
}

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function loadCredentials() {
  const raw = process.env.ACTOR_CREDENTIALS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const out = {};
    for (const [username, hash] of Object.entries(parsed)) {
      const role = username.toLowerCase();
      if (ROLES[role] && typeof hash === 'string' && hash.startsWith('scrypt$')) out[role] = hash;
    }
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.error('[auth] ACTOR_CREDENTIALS is not valid JSON');
    return null;
  }
}

function isConfigured() {
  return Boolean(loadCredentials() && sessionSecret());
}

function verifyPassword(username, password) {
  const creds = loadCredentials();
  const role = String(username || '').trim().toLowerCase();
  // Always run one scrypt so a wrong username costs the same time as a wrong password.
  const stored = (creds && creds[role]) || hashPassword('decoy', '00'.repeat(16));
  const [, saltHex, hashHex] = stored.split('$');
  const candidate = hashPassword(password || '', saltHex).split('$')[2];
  const ok = crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hashHex, 'hex'));
  if (!ok || !creds || !creds[role]) return null;
  return ROLES[role];
}

// ---------------------------------------------------------------------------
// Signed session token
// ---------------------------------------------------------------------------
function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function issueToken(actors) {
  const secret = sessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ actors, iat: now, exp: now + SESSION_HOURS * 3600 })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function readToken(token) {
  const secret = sessionSecret();
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = sign(body, secret);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    const actors = Array.isArray(data.actors) ? data.actors.filter((a) => ACTOR_NAMES[a]) : [];
    return actors.length ? { actors, exp: data.exp } : null;
  } catch (err) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function getSession(req) {
  return readToken(parseCookies(req.headers.cookie)[COOKIE]);
}

function setSessionCookie(req, res, actors) {
  const secure = ON_VERCEL || req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (!actors.length) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
    return;
  }
  res.setHeader('Set-Cookie',
    `${COOKIE}=${issueToken(actors)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`);
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------
function requireSession(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Sign in required', login: '/login' });
  req.session = session;
  next();
}

// actorOf(req) returns the actor the request acts as; it must be signed in.
function requireActor(actorOf) {
  return function (req, res, next) {
    const session = req.session || getSession(req);
    if (!session) return res.status(401).json({ error: 'Sign in required', login: '/login' });
    req.session = session;
    const actorId = typeof actorOf === 'function' ? actorOf(req) : actorOf;
    if (!actorId || !session.actors.includes(String(actorId))) {
      const name = ACTOR_NAMES[actorId] || 'this actor';
      return res.status(403).json({ error: `You are not signed in as ${name}` });
    }
    // A portal can only act as its own actor, even if other actors are
    // signed in on the same browser (e.g. four portals open side by side).
    const portal = req.actingAs || actingAs(req);
    if (portal && portal !== String(actorId)) {
      return res.status(403).json({ error: `The ${ACTOR_NAMES[portal]} portal cannot act as ${ACTOR_NAMES[actorId] || 'another actor'}` });
    }
    next();
  };
}

// actingAs(req) — which signed-in actor this request speaks for. Each portal
// sends an X-Acting-As header with its own actor id; the header must name an
// actor that is actually signed in on this browser, otherwise null (refused).
// Without the header (scripts, older clients) the Patient is assumed when
// signed in, else the first signed-in actor.
function actingAs(req) {
  const session = req.session || getSession(req);
  if (!session) return null;
  const wanted = String(req.headers['x-acting-as'] || '').trim();
  if (wanted) return session.actors.includes(wanted) ? wanted : null;
  return session.actors.includes('01') ? '01' : session.actors[0];
}

// Refuses a request whose X-Acting-As names an actor that is not signed in.
function requireActingAs(req, res, next) {
  const actorId = actingAs(req);
  if (!actorId) {
    const name = ACTOR_NAMES[String(req.headers['x-acting-as'] || '')] || 'that actor';
    return res.status(403).json({ error: `You are not signed in as ${name}`, login: '/login' });
  }
  req.actingAs = actorId;
  next();
}

module.exports = {
  COOKIE,
  actingAs,
  requireActingAs,
  ROLES,
  ACTOR_NAMES,
  hashPassword,
  verifyPassword,
  isConfigured,
  getSession,
  setSessionCookie,
  requireSession,
  requireActor,
};
