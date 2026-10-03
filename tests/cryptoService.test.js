const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cryptoService = require('../src/services/cryptoService');

describe('AES-256-GCM', () => {
  test('encrypt/decrypt round-trips', async () => {
    const cek = await cryptoService.generateCEK();
    const plain = Buffer.from('patient record: blood group O+');
    const { package: pkg } = cryptoService.encryptAESGCM(plain, cek);
    expect(pkg.equals(plain)).toBe(false);
    expect(cryptoService.decryptAESGCM(pkg, cek).equals(plain)).toBe(true);
  });

  test('tampered ciphertext is rejected', async () => {
    const cek = await cryptoService.generateCEK();
    const { package: pkg } = cryptoService.encryptAESGCM(Buffer.from('hello'), cek);
    pkg[pkg.length - 1] ^= 0xff;
    expect(() => cryptoService.decryptAESGCM(pkg, cek)).toThrow();
  });
});

describe('RSA-OAEP key wrapping', () => {
  test('wrap/unwrap round-trips', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const cek = await cryptoService.generateCEK();
    const wrapped = cryptoService.wrapKeyRSA(cek, publicKey);
    expect(Buffer.from(cryptoService.unwrapKeyRSA(wrapped, privateKey)).equals(Buffer.from(cek))).toBe(true);
  });
});

describe('X25519 key wrapping', () => {
  test('wrap/unwrap round-trips and never exposes the CEK', () => {
    const recipient = cryptoService.generateX25519KeyPair();
    const cek = crypto.randomBytes(32);
    const { wrappedKey, ephemeralPublicKey } = cryptoService.wrapKeyX25519(cek, recipient.publicKey);
    expect(wrappedKey.includes(cek)).toBe(false);
    const unwrapped = cryptoService.unwrapKeyX25519(wrappedKey, Buffer.from(ephemeralPublicKey), Buffer.from(recipient.privateKey));
    expect(unwrapped.equals(cek)).toBe(true);
  });

  test('wrong recipient cannot unwrap', () => {
    const recipient = cryptoService.generateX25519KeyPair();
    const other = cryptoService.generateX25519KeyPair();
    const { wrappedKey, ephemeralPublicKey } = cryptoService.wrapKeyX25519(crypto.randomBytes(32), recipient.publicKey);
    expect(() => cryptoService.unwrapKeyX25519(wrappedKey, Buffer.from(ephemeralPublicKey), Buffer.from(other.privateKey))).toThrow();
  });

  const keyFile = path.join(__dirname, '..', 'scripts', 'keys', 'actor-02-doctor-x25519-pub.key');
  (fs.existsSync(keyFile) ? test : test.skip)('loads actor X25519 public keys from scripts/keys', async () => {
    const pub = await cryptoService.loadActorX25519PublicKey('02');
    expect(pub.length).toBe(32);
  });

  test('rejects unknown actor ids', async () => {
    await expect(cryptoService.loadActorX25519PublicKey('99')).rejects.toThrow('Invalid actorId');
  });
});
