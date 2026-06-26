const { Blob } = require('buffer');
const { setTimeout: sleep } = require('timers/promises');

const fetchImpl = globalThis.fetch;
const FormDataImpl = globalThis.FormData;
const AbortSignalImpl = globalThis.AbortSignal;
if (!fetchImpl || !FormDataImpl || !AbortSignalImpl) {
  throw new Error('Node 18+ runtime with fetch/FormData support is required.');
}

let ipfsModulePromise;
function getIpfsModule() {
  if (!ipfsModulePromise) {
    ipfsModulePromise = import('ipfs-http-client');
  }
  return ipfsModulePromise;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const UPLOAD_TIMEOUT_MS = 60_000;

function getProvider() {
  return (process.env.IPFS_PROVIDER || 'local').toLowerCase();
}

async function buildIpfsClient() {
  const provider = getProvider();
  if (provider === 'pinata') {
    return null; // handled via REST API flow below
  }
  const { create } = await getIpfsModule();
  const url = provider === 'infura'
    ? `https://ipfs.infura.io:5001/api/v0`
    : process.env.IPFS_API_URL || 'http://127.0.0.1:5001/api/v0';
  return create({ url });
}

async function uploadViaIpfsClient(buf) {
  const client = await buildIpfsClient();
  if (!client) {
    throw new Error('IPFS HTTP client not configured');
  }
  const result = await client.add(buf, { timeout: UPLOAD_TIMEOUT_MS, pin: true });
  return result.cid.toString();
}

async function uploadViaPinata(buf) {
  const key = process.env.PINATA_KEY;
  const secret = process.env.PINATA_SECRET;
  if (!key || !secret) {
    throw new Error('PINATA_KEY and PINATA_SECRET must be set for Pinata uploads');
  }
  const form = new FormDataImpl();
  form.append('file', new Blob([buf]), 'encrypted.bin');
  const controller = AbortSignalImpl.timeout(UPLOAD_TIMEOUT_MS);
  const response = await fetchImpl('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      pinata_api_key: key,
      pinata_secret_api_key: secret,
    },
    body: form,
    signal: controller,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} ${text}`);
  }
  const json = await response.json();
  return json.IpfsHash;
}

async function uploadMock(buf) {
  // Deterministic CID mock for offline demos; never use in production.
  const fakeHash = require('./cryptoService').sha256hex(buf).slice(0, 46);
  return `bafy${fakeHash}`;
}

/**
 * Uploads an encrypted payload to IPFS with retries and timeout.
 * For Pinata, set IPFS_PROVIDER=pinata and PINATA_KEY/PINATA_SECRET env vars.
 * For Infura, set IPFS_PROVIDER=infura and provide IPFS_API_URL or rely on default.
 * Set MOCK_IPFS_UPLOAD=true to bypass network during local demos/tests.
 * @param {Buffer} buf
 * @returns {Promise<{cid: string}>}
 */
async function uploadBufferToIPFS(buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('Buffer required for IPFS upload');
  }
  const provider = getProvider();
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const cid = process.env.MOCK_IPFS_UPLOAD === 'true'
        ? await uploadMock(buf)
        : provider === 'pinata'
          ? await uploadViaPinata(buf)
          : await uploadViaIpfsClient(buf);
      return { cid };
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw err;
      }
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error('IPFS upload exhausted retries');
}

/**
 * Downloads content from IPFS by CID.
 * For production, use Pinata Gateway or local IPFS node.
 * @param {string} cid - IPFS CID
 * @returns {Promise<Buffer>}
 */
async function downloadFromIPFS(cid) {
  if (!cid || typeof cid !== 'string') {
    throw new Error('Valid CID required for IPFS download');
  }

  // Mock mode: cannot download (no real storage)
  if (process.env.MOCK_IPFS_UPLOAD === 'true') {
    throw new Error('Cannot download in MOCK_IPFS_UPLOAD mode - no real storage exists');
  }

  const provider = getProvider();
  
  try {
    if (provider === 'pinata') {
      // Use Pinata gateway
      const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
      const controller = AbortSignalImpl.timeout(UPLOAD_TIMEOUT_MS);
      const response = await fetchImpl(gatewayUrl, { signal: controller });
      
      if (!response.ok) {
        throw new Error(`Pinata download failed: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else {
      // Use local IPFS client
      const client = await buildIpfsClient();
      if (!client) {
        throw new Error('IPFS client not configured');
      }
      
      const chunks = [];
      for await (const chunk of client.cat(cid, { timeout: UPLOAD_TIMEOUT_MS })) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
  } catch (err) {
    throw new Error(`IPFS download failed for CID ${cid}: ${err.message}`);
  }
}

module.exports = {
  uploadBufferToIPFS,
  downloadFromIPFS,
};
