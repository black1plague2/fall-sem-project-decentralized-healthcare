# Cardano Healthcare Vault - Backend

Decentralized Electronic Health Record (EHR) system with encrypted medical file storage on IPFS, immutable verification on Cardano blockchain, and multi-layer permission control.

## 🏗️ Architecture

### Core Components
- **Encryption Service**: AES-256-GCM authenticated encryption
- **IPFS Storage**: Pinata-backed decentralized file storage
- **4-Layer Permission System**:
  1. **Hydra Layer-2** (5-15ms) - Off-chain state channels, 100-400x faster
  2. **Aiken Layer-1** (~2s) - Plutus V3 smart contracts
  3. **Midnight ZK** (800-1200ms) - Zero-knowledge proofs
  4. **Blockfrost L1** (500-2000ms) - Public blockchain fallback
- **Audit Logging**: Winston-based 90-day retention, HIPAA/GDPR compliant
- **Key Management**: In-memory CEK store with RSA-OAEP wrapping

## 🚀 Quick Start (demo mode — no real API keys needed)

### Prerequisites
- Node.js 18+
- MongoDB running locally (or update `DB_URI` to a remote instance)
- Redis is optional — `DISABLE_REDIS=true` uses an in-memory CEK cache instead

### Installation

```bash
npm install
cd mock-hydra && npm install && cd ..
```

### Configuration

```bash
cp .env.example .env
```

The defaults in `.env.example` run the whole system in **DEMO_MODE**: encryption
and Hydra L2 are genuinely live, everything else (IPFS, Midnight, Blockfrost,
wallet signatures) runs against mocked/local scaffolding so the full pipeline
works without any real credentials. See the comments in `.env.example` for
where to plug in real Blockfrost/Pinata/Midnight keys later — flip
`DEMO_MODE=false` once you do.

### Generate actor keys (once)

```bash
node scripts/genActorKeys.js
```

This generates RSA key pairs for 4 actors:
- 01 - Patient
- 02 - Doctor
- 03 - Hospital
- 04 - Insurance

### Run

```bash
# Terminal 1 — mock Hydra L2 node
cd mock-hydra && npm start

# Terminal 2 — main server
npm start        # or: npm run dev (nodemon)
```

Then open **http://localhost:4000** for the landing page, and
**http://localhost:4000/dashboard** for the working demo: switch between
Patient/Doctor/Hospital/Insurance, upload & encrypt a file, request access,
unlock, and revoke access, watching each backend step stream in live over
Server-Sent Events.

**Wallets:** with an [Eternl](https://eternl.io) extension installed, "Connect
Wallet" uses it and signs every action with CIP-8. Without one, and only while
the server runs with `DEMO_MODE=true`, the dashboard falls back to a demo
wallet so the full pipeline can still be shown in any browser.

```mermaid
flowchart LR
    P[Patient uploads file] --> E[Encrypt with AES-256-GCM]
    E --> I[Store on IPFS]
    E --> W[Wrap key for each chosen actor]
    W --> H[Share via Hydra L2]
    D[Doctor asks for access] --> C{Permission check<br/>Hydra, Aiken, Midnight, Blockfrost}
    C -->|allowed| U[Doctor unwraps key and reads file]
    C -->|denied| X[Access denied + audit log]
    R[Patient revokes access] --> K[New key, file re-encrypted]
```

## 📡 API Endpoints

### Upload & Encrypt
```bash
POST /api/encrypt/upload
Content-Type: multipart/form-data

Body:
- file: medical file
- ownerAddr: wallet address
- actorIds: comma-separated (e.g., "01,02,03")
```

### Access Request
```bash
POST /api/access/request
Content-Type: application/json

{
  "recordId": "uuid",
  "actorId": "02",
  "actorAddr": "addr_test1...",
  "actorSignature": "signature"
}
```

### Revoke Access
```bash
POST /api/encrypt/revoke
Content-Type: application/json

{
  "recordId": "uuid",
  "actorId": "03",
  "ownerAddr": "addr_test1...",
  "ownerSignature": "signature"
}
```

### Share via Hydra L2
```bash
POST /api/encrypt/propose-share
Content-Type: application/json

{
  "headId": "head-...",
  "payload": { "operation": "share", "recordId": "uuid", "actors": ["doctor"], "timestamp": 1730000000000 },
  "signature": { "key": "...", "signature": "..." }
}
```
The payload must be signed by the record owner. Each actor gets the file key
wrapped under their own X25519 public key, so the Hydra snapshot never holds
the plain key.

### Confirm On-chain Anchor
```bash
POST /api/encrypt/confirm-anchor
Content-Type: application/json

{ "recordId": "uuid", "onchainTxHash": "..." }
```
With a Blockfrost key set, the transaction must exist and its metadata must
contain the record's `cidHash`. After a revoke rotates the key of an anchored
record, the record goes back to `pending_anchor` until the owner anchors the
new CID the same way.

### Hydra Health
```bash
GET /api/hydra/health
```

### Get Metadata
```bash
GET /api/records/:recordId/metadata
```

## 🔐 Security Features

- **AES-256-GCM**: Military-grade authenticated encryption
- **Key Isolation**: Separate wrapped key per actor
- **CEK Rotation**: Automatic re-encryption on revocation
- **Signature Verification**: CIP-8 wallet signatures, checked in full (Ed25519 signature, signed payload, signing address, and that the key owns that address), with a 10-minute freshness window
- **Audit Logging**: Every operation logged with requestId
- **No PHI Leakage**: No plaintext in logs or database

## 🎨 Demo Interface

- `/` — landing page (`public/index.html` + `landing.css` + `landing.js`)
- `/dashboard` — the main working demo (`public/dashboard.html` + `dashboard.css` + `dashboard.js`)
- `/api/logs` — audit log viewer

Older pages are still reachable for reference: `/app` (earlier wallet-connect
UI), `/demo` (older encryption-only demo), and `public/api-demo.html`.

## 📁 Project Structure

```
backend/
├── src/
│   ├── controllers/     # API request handlers
│   ├── services/        # Business logic
│   │   ├── cryptoService.js
│   │   ├── ipfsService.js
│   │   ├── hydraClient.js
│   │   ├── aikenService.js
│   │   ├── midnightService.js
│   │   ├── permissionService.js
│   │   └── auditLogger.js
│   ├── models/          # MongoDB schemas
│   ├── routes/          # Express routes
│   └── utils/           # Helper functions
├── public/              # Frontend — index.html (landing) + dashboard.html (main demo)
├── api/                 # Vercel serverless entry point
├── tests/               # Jest tests
├── contracts/           # Aiken smart contracts
├── mock-hydra/          # Hydra Layer-2 mock server
├── scripts/             # Utility scripts
└── package.json
```

## 🔧 Tech Stack

- **Backend**: Node.js 18+, Express
- **Database**: MongoDB, Redis
- **Encryption**: Native crypto module (AES-256-GCM, RSA-OAEP)
- **Storage**: IPFS via Pinata
- **Blockchain**: Cardano (Blockfrost API)
- **Layer-2**: Hydra state channels
- **Smart Contracts**: Aiken (Plutus V3)
- **Zero-Knowledge**: Midnight ZK proofs
- **Logging**: Winston

## 📊 Performance

- **Hydra L2**: 5-15ms (100-400x faster than L1)
- **Aiken L1**: ~2000ms
- **Midnight ZK**: 800-1200ms
- **Blockfrost L1**: 500-2000ms
- **CEK Rotation**: <500ms for typical files

## 🧪 Testing

```bash
# Run all tests (crypto, CIP-8 signature checks, anchor checks, API smoke tests)
npm test

# Run demo flow
npm run demo
```

## 📝 Compliance

- **HIPAA**: No PHI in logs, encrypted at rest and in transit
- **GDPR**: 90-day log retention, right to erasure via CEK rotation
- **Audit Trail**: Complete requestId correlation
- **Access Control**: Multi-layer permission verification

## 🤝 Actors

- **01**: Patient (owner, full control)
- **02**: Doctor (read/write medical records)
- **03**: Hospital (institutional access)
- **04**: Insurance (billing/claims verification)

## 📄 License

MIT

## 🔗 Related

- [Cardano Documentation](https://docs.cardano.org/)
- [Hydra Head Protocol](https://hydra.family/)
- [Aiken Smart Contracts](https://aiken-lang.org/)
- [Midnight Network](https://midnight.network/)
