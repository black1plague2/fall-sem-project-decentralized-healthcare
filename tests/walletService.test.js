const crypto = require('crypto');
const cbor = require('cbor');
const blake2b = require('blake2b');
const walletService = require('../src/services/walletService');

// --- Minimal CIP-30 wallet simulator: Ed25519 key, enterprise testnet
// address, and signData() output in the exact COSE shape wallets return.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function bech32Encode(hrp, bytes) {
  const data = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; data.push((acc >> bits) & 31); }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const hrpExp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = polymod(hrpExp.concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return hrp + '1' + data.concat(checksum).map((d) => CHARSET[d]).join('');
}

function makeWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const addrBytes = Buffer.concat([Buffer.from([0x60]), Buffer.from(blake2b(28).update(rawPub).digest())]); // enterprise, testnet
  const address = bech32Encode('addr_test', addrBytes);

  async function signData(message, signingAddrBytes = addrBytes) {
    const protectedMap = new Map([[1, -8], ['address', signingAddrBytes]]);
    const protectedBytes = await cbor.encodeAsync(protectedMap);
    const payload = Buffer.from(message, 'utf8');
    const sigStructure = await cbor.encodeAsync(['Signature1', protectedBytes, Buffer.alloc(0), payload]);
    const sig = crypto.sign(null, sigStructure, privateKey);
    const sign1 = await cbor.encodeAsync([protectedBytes, { hashed: false }, payload, sig]);
    const coseKey = await cbor.encodeAsync(new Map([[1, 1], [3, -8], [-1, 6], [-2, rawPub]]));
    return { signature: sign1.toString('hex'), key: coseKey.toString('hex') };
  }
  return { address, addrBytes, signData };
}

describe('CIP-8 signature verification', () => {
  const payload = JSON.stringify({ operation: 'revoke', recordId: 'r1', timestamp: Date.now(), network: 'testnet' });

  test('bech32Decode recovers address bytes', () => {
    const w = makeWallet();
    const { hrp, bytes } = walletService.bech32Decode(w.address);
    expect(hrp).toBe('addr_test');
    expect(bytes.equals(w.addrBytes)).toBe(true);
  });

  test('accepts a valid wallet signature', async () => {
    const w = makeWallet();
    await expect(walletService.verifyWalletSignature(w.address, payload, await w.signData(payload))).resolves.toBe(true);
  });

  test('accepts hex-encoded addresses (what CIP-30 getUsedAddresses returns)', async () => {
    const w = makeWallet();
    await expect(walletService.verifyWalletSignature(w.addrBytes.toString('hex'), payload, await w.signData(payload))).resolves.toBe(true);
  });

  test('rejects a signature over a different payload', async () => {
    const w = makeWallet();
    const other = payload.replace('revoke', 'unlock');
    await expect(walletService.verifyWalletSignature(w.address, other, await w.signData(payload))).resolves.toBe(false);
  });

  test("rejects a valid signature from someone else's wallet", async () => {
    const victim = makeWallet();
    const attacker = makeWallet();
    // Attacker signs with their own key but claims the victim's address
    const signed = await attacker.signData(payload, victim.addrBytes);
    await expect(walletService.verifyWalletSignature(victim.address, payload, signed)).resolves.toBe(false);
  });

  test('rejects a corrupted signature', async () => {
    const w = makeWallet();
    const signed = await w.signData(payload);
    const sigHex = signed.signature;
    signed.signature = sigHex.slice(0, -2) + (sigHex.endsWith('00') ? '01' : '00');
    await expect(walletService.verifyWalletSignature(w.address, payload, signed)).resolves.toBe(false);
  });

  test('rejects missing fields and garbage', async () => {
    const w = makeWallet();
    await expect(walletService.verifyWalletSignature(w.address, payload, {})).resolves.toBe(false);
    await expect(walletService.verifyWalletSignature(w.address, payload, { key: 'zz', signature: 'zz' })).resolves.toBe(false);
  });
});

describe('verifySignature mode handling', () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => { process.env.DEMO_MODE = original; });

  test('DEMO_MODE bypasses verification but still needs a signature', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(walletService.verifySignature('addr', '{}', { key: 'x', signature: 'y' })).resolves.toBe(true);
    await expect(walletService.verifySignature('addr', '{}', null)).resolves.toBe(false);
  });

  test('production mode verifies real signatures and rejects stale ones', async () => {
    process.env.DEMO_MODE = 'false';
    const w = makeWallet();
    const fresh = JSON.stringify({ operation: 'x', recordId: 'r', timestamp: Date.now() });
    await expect(walletService.verifySignature(w.address, fresh, await w.signData(fresh))).resolves.toBe(true);

    const stale = JSON.stringify({ operation: 'x', recordId: 'r', timestamp: Date.now() - 60 * 60 * 1000 });
    await expect(walletService.verifySignature(w.address, stale, await w.signData(stale))).resolves.toBe(false);
  });

  test('production mode rejects HMAC string signatures', async () => {
    process.env.DEMO_MODE = 'false';
    const fresh = JSON.stringify({ timestamp: Date.now() });
    await expect(walletService.verifySignature('addr', fresh, 'deadbeef')).rejects.toThrow('HMAC');
  });
});
