const sim = require('../src/services/hydraSimulator');
const { HydraClient } = require('../src/services/hydraClient');

describe('hydraSimulator', () => {
  test('default head is seeded with synthetic, signed history', () => {
    const status = sim.getHeadStatus(sim.DEFAULT_HEAD_ID);
    expect(status.status).toBe('open');
    expect(status.epoch).toBeGreaterThan(0);
    expect(status.parties).toHaveLength(4);
    expect(status.latestVerified).toBe(true);
    expect(status.snapshots[0].signatures).toBe(4);
  });

  test('a proposed update is accepted and lists the permitted actors', async () => {
    const res = await sim.proposeUpdate(sim.DEFAULT_HEAD_ID, {
      type: 'SHARE_RECORD',
      recordId: 'rec-test-1',
      cidHash: 'abc',
      wrappedKeys: [{ actorId: '01' }, { actorId: '02' }],
      author: 'addr_test',
    });
    expect(res.status).toBe('accepted');
    expect(res.snapshot.records['rec-test-1'].permittedActors).toEqual(['01', '02']);
    expect(sim.verifySnapshot(sim.DEFAULT_HEAD_ID, res.snapshot)).toBe(true);
  });

  test('tampering with a signed snapshot breaks verification', async () => {
    const res = await sim.proposeUpdate(sim.DEFAULT_HEAD_ID, {
      type: 'SHARE_RECORD',
      recordId: 'rec-test-2',
      cidHash: 'def',
      wrappedKeys: [{ actorId: '01' }],
      author: 'addr_test',
    });
    const forged = JSON.parse(JSON.stringify(res.snapshot));
    forged.records['rec-test-2'].permittedActors.push('04'); // sneak Insurance in
    expect(sim.verifySnapshot(sim.DEFAULT_HEAD_ID, forged)).toBe(false);
  });

  test('rejects updates without type or recordId', async () => {
    await expect(sim.proposeUpdate(sim.DEFAULT_HEAD_ID, { type: 'SHARE_RECORD' })).rejects.toThrow(/recordId/);
  });

  test('an unknown head id is recreated instead of 404ing (serverless instances)', async () => {
    const snap = await sim.getLatestSnapshot('head-from-another-instance');
    expect(snap.status).toBe('open');
  });
});

describe('HydraClient fallback', () => {
  test('falls back to the simulator when the node is unreachable', async () => {
    // Port 9 (discard) is almost never listening, so the connection is refused.
    const client = new HydraClient({ hydraBaseUrl: 'http://127.0.0.1:9', timeout: 2000, mode: 'auto' });
    const health = await client.health();
    expect(client.mode).toBe('simulated');
    expect(health.service).toBe('hydra-simulator');
    expect(client.fallbackReason).toMatch(/unreachable/);
  });

  test('HYDRA_MODE=remote does not fall back', async () => {
    const client = new HydraClient({ hydraBaseUrl: 'http://127.0.0.1:9', timeout: 2000, mode: 'remote' });
    await expect(client.health()).rejects.toThrow(/Hydra health check failed/);
    expect(client.mode).toBe('remote');
  });
});
