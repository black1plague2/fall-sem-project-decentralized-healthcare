// Actor sign-in: password check, signed session cookie, per-actor access.
process.env.DEMO_MODE = 'true';
process.env.DISABLE_REDIS = 'true';
process.env.SESSION_SECRET = 'x'.repeat(64);

const { hashPassword } = require('../src/services/authService');
process.env.ACTOR_CREDENTIALS = JSON.stringify({
  patient: hashPassword('patient-pass'),
  doctor: hashPassword('doctor-pass'),
  hospital: hashPassword('hospital-pass'),
  insurance: hashPassword('insurance-pass'),
});

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
});

function cookieFrom(res) {
  return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}

test('wrong password is refused and no cookie is set', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'doctor', password: 'nope' });
  expect(res.status).toBe(401);
  expect(res.headers['set-cookie']).toBeUndefined();
});

test('unknown user is refused the same way', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'patient-pass' });
  expect(res.status).toBe(401);
});

test('a signed-in patient gets an HttpOnly, SameSite=Strict session', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'Patient', password: 'patient-pass' });
  expect(res.status).toBe(200);
  expect(res.body.actorId).toBe('01');
  const raw = res.headers['set-cookie'][0];
  expect(raw).toMatch(/HttpOnly/);
  expect(raw).toMatch(/SameSite=Strict/);

  const session = await request(app).get('/api/auth/session').set('Cookie', cookieFrom(res));
  expect(session.body.actors).toEqual(['01']);

  const dash = await request(app).get('/dashboard').set('Cookie', cookieFrom(res));
  expect(dash.status).toBe(200);
});

test('record APIs need a session', async () => {
  const res = await request(app).get('/api/records');
  expect(res.status).toBe(401);
});

test('a tampered cookie is rejected', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'doctor', password: 'doctor-pass' });
  const cookie = cookieFrom(login);
  const [name, value] = cookie.split('=');
  const [body, mac] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ actors: ['01', '02'], iat: 1, exp: 9999999999 })).toString('base64url');
  const res = await request(app).get('/api/auth/session').set('Cookie', `${name}=${forged}.${mac}`);
  expect(res.body.actors).toEqual([]);
  expect(body).not.toBe(forged);
});

test('a doctor cannot act as the patient or as another actor', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'doctor', password: 'doctor-pass' });
  const cookie = cookieFrom(login);

  const revoke = await request(app).post('/api/encrypt/revoke').set('Cookie', cookie)
    .send({ recordId: '00000000-0000-4000-8000-000000000000', actorId: '03' });
  expect(revoke.status).toBe(403);

  const asHospital = await request(app).post('/api/access/request').set('Cookie', cookie)
    .send({ recordId: '00000000-0000-4000-8000-000000000000', actorId: '03' });
  expect(asHospital.status).toBe(403);
});

test('signing in a second actor keeps the first', async () => {
  const first = await request(app).post('/api/auth/login').send({ username: 'patient', password: 'patient-pass' });
  const second = await request(app).post('/api/auth/login').set('Cookie', cookieFrom(first))
    .send({ username: 'insurance', password: 'insurance-pass' });
  expect(second.body.actors).toEqual(['01', '04']);

  const out = await request(app).post('/api/auth/logout').set('Cookie', cookieFrom(second)).send({});
  expect(out.body.actors).toEqual([]);
});

test('demo buttons sign in one role or all four, only in DEMO_MODE', async () => {
  const one = await request(app).post('/api/auth/demo-login').send({ role: 'hospital' });
  expect(one.status).toBe(200);
  expect(one.body.actors).toEqual(['03']);

  const all = await request(app).post('/api/auth/demo-login').send({ role: 'all' });
  expect(all.body.actors).toEqual(['01', '02', '03', '04']);

  const bad = await request(app).post('/api/auth/demo-login').send({ role: 'admin' });
  expect(bad.status).toBe(400);

  process.env.DEMO_MODE = 'false';
  const off = await request(app).post('/api/auth/demo-login').send({ role: 'patient' });
  expect(off.status).toBe(404);
  process.env.DEMO_MODE = 'true';
});
