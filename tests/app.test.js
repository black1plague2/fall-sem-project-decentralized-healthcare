// Smoke tests for the routes that don't need MongoDB.
process.env.DEMO_MODE = 'true';
process.env.DISABLE_REDIS = 'true';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
});

test('GET /health reports ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('GET /api/config lists every layer with a mode', async () => {
  const res = await request(app).get('/api/config');
  expect(res.status).toBe(200);
  expect(res.body.demoMode).toBe(true);
  for (const layer of ['encryption', 'ipfs', 'hydra', 'aiken', 'midnight', 'blockfrost', 'walletSignatures']) {
    expect(res.body.layers[layer].mode).toEqual(expect.any(String));
  }
});

test('landing page and dashboard are served', async () => {
  const landing = await request(app).get('/');
  expect(landing.status).toBe(200);
  expect(landing.text).toContain('Cardano Healthcare Vault');

  const dash = await request(app).get('/dashboard');
  expect(dash.status).toBe(200);
});
