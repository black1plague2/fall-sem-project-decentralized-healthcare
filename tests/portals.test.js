// Each actor has its own portal, and the server holds every request to the
// portal it comes from. These checks run before any database access.
const auth = require('../src/services/authService');

process.env.DEMO_MODE = 'true';
process.env.DISABLE_REDIS = 'true';
process.env.SESSION_SECRET = 'x'.repeat(48);
process.env.ACTOR_CREDENTIALS = JSON.stringify({
  patient: auth.hashPassword('p-pass'),
  doctor: auth.hashPassword('d-pass'),
  hospital: auth.hashPassword('h-pass'),
  insurance: auth.hashPassword('i-pass'),
});

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');

afterAll(async () => { await mongoose.disconnect().catch(() => {}); });

async function signIn(agent, role, password) {
  const res = await agent.post('/api/auth/login').send({ username: role, password });
  expect(res.status).toBe(200);
}

test('a portal sends a signed-out visitor to that role\'s sign-in', async () => {
  const res = await request(app).get('/portal/doctor');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/login?role=doctor&next=/portal/doctor');
});

test('a portal opens only for its own actor and is locked to it', async () => {
  const agent = request.agent(app);
  await signIn(agent, 'doctor', 'd-pass');
  const own = await agent.get('/portal/doctor');
  expect(own.status).toBe(200);
  expect(own.text).toContain('data-role="doctor"');
  expect(own.text).toContain('data-actor="02"');
  expect(own.text).not.toContain('actor-row'); // no actor switcher
  const other = await agent.get('/portal/patient');
  expect(other.status).toBe(302);
  expect(other.headers.location).toContain('role=patient');
});

test('the old dashboard forwards to the signed-in actor\'s portal', async () => {
  const agent = request.agent(app);
  await signIn(agent, 'insurance', 'i-pass');
  const res = await agent.get('/dashboard');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/portal/insurance');
});

test('a request cannot claim a portal whose actor is not signed in', async () => {
  const agent = request.agent(app);
  await signIn(agent, 'doctor', 'd-pass');
  const res = await agent.get('/api/records').set('X-Acting-As', '01');
  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/not signed in as Patient/);
});

test('signing out of one portal keeps the others signed in', async () => {
  const agent = request.agent(app);
  await signIn(agent, 'doctor', 'd-pass');
  await signIn(agent, 'hospital', 'h-pass');
  const out = await agent.post('/api/auth/logout').send({ actorId: '02' });
  expect(out.body.actors).toEqual(['03']);
  expect((await agent.get('/portal/hospital')).status).toBe(200);
  expect((await agent.get('/portal/doctor')).status).toBe(302);
});

test('the guided demo page is served', async () => {
  const res = await request(app).get('/present');
  expect(res.status).toBe(200);
  expect(res.text).toContain('Start the demo');
});
