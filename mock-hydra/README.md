# Mock Hydra Server

Mock Hydra Head API server for local development without requiring real Cardano infrastructure.

## Features

- ✅ Simulates Hydra Head creation, updates, and finalization
- ✅ In-memory snapshot storage
- ✅ Instant update acceptance (no multi-party confirmation delay)
- ✅ No Cardano node required
- ✅ No ADA required
- ✅ Works on localhost
- ⚠️ Development only - NOT for production

## Installation

```bash
cd mock-hydra
npm install
```

## Usage

### Start Server

```bash
npm start
# or with auto-reload
npm run dev
```

Server runs on port **4001** by default (configure via `MOCK_HYDRA_PORT` env var).

### API Endpoints

#### 1. Health Check
```bash
GET /health
```

**Response:**
```json
{
  "ok": true,
  "service": "mock-hydra",
  "version": "1.0.0",
  "headsCount": 2,
  "timestamp": 1732896000000
}
```

#### 2. Create Head
```bash
POST /heads
Content-Type: application/json

{
  "parties": ["addr1...", "addr2..."],
  "contestationPeriod": 60
}
```

**Response:**
```json
{
  "headId": "head-1732896000-abc123",
  "status": "open",
  "parties": ["addr1...", "addr2..."],
  "contestationPeriod": 60,
  "message": "Mock head created (no on-chain TX required in dev mode)"
}
```

#### 3. Propose Update
```bash
POST /heads/:headId/propose
Content-Type: application/json

{
  "type": "SHARE_RECORD",
  "recordId": "rec-uuid-123",
  "cidHash": "bafybe...",
  "wrappedKeys": [
    {
      "actorId": "02",
      "wrappedKey": "base64...",
      "ephemeralPublicKey": "base64..."
    }
  ],
  "author": "addr1...",
  "timestamp": 1732896000000
}
```

**Response:**
```json
{
  "status": "accepted",
  "snapshotId": "snapshot-head-abc123-1",
  "epoch": 1,
  "snapshot": {
    "epoch": 1,
    "snapshotId": "snapshot-head-abc123-1",
    "records": {
      "rec-uuid-123": {
        "cidHash": "bafybe...",
        "permittedActors": ["02"],
        "wrappedKeys": [...],
        "author": "addr1...",
        "lastUpdated": 1732896000000
      }
    },
    "acceptedAt": 1732896000000,
    "updateType": "SHARE_RECORD"
  },
  "message": "Mock instant acceptance (real hydra-node requires multi-sig)"
}
```

#### 4. Get Latest Snapshot
```bash
GET /heads/:headId/snapshot
```

**Response:**
```json
{
  "headId": "head-abc123",
  "status": "open",
  "snapshot": {
    "epoch": 5,
    "records": {...},
    "acceptedAt": 1732896000000
  },
  "snapshotsCount": 5
}
```

#### 5. Get All Snapshots (History)
```bash
GET /heads/:headId/snapshots
```

**Response:**
```json
{
  "headId": "head-abc123",
  "snapshots": [...],
  "count": 5
}
```

#### 6. Close Head
```bash
POST /heads/:headId/close
Content-Type: application/json

{
  "reason": "End of session"
}
```

**Response:**
```json
{
  "status": "closed",
  "txHash": "mock-tx-1732896000-xyz789",
  "snapshot": {...},
  "message": "Mock close (no on-chain TX in dev mode)"
}
```

#### 7. List All Heads (Dev Utility)
```bash
GET /heads
```

**Response:**
```json
{
  "heads": [
    {
      "headId": "head-abc123",
      "status": "open",
      "epoch": 5,
      "recordsCount": 10,
      "snapshotsCount": 5,
      "createdAt": 1732896000000
    }
  ],
  "count": 1
}
```

#### 8. Delete Head (Dev Utility)
```bash
DELETE /heads/:headId
```

**Response:**
```json
{
  "message": "Head deleted",
  "headId": "head-abc123"
}
```

## Testing

### Quick Test
```bash
# Start server
npm start

# In another terminal
curl http://localhost:4001/health

# Create head
curl -X POST http://localhost:4001/heads \
  -H "Content-Type: application/json" \
  -d '{"parties":["addr1"]}'

# Propose update (replace HEAD_ID)
curl -X POST http://localhost:4001/heads/HEAD_ID/propose \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SHARE_RECORD",
    "recordId": "test-123",
    "cidHash": "bafybeiabc123",
    "wrappedKeys": [{"actorId":"02","wrappedKey":"test","ephemeralPublicKey":"test"}],
    "author": "addr1test",
    "timestamp": 1732896000000
  }'

# Get snapshot
curl http://localhost:4001/heads/HEAD_ID/snapshot
```

## Differences from Real Hydra Node

| Feature | Mock | Real Hydra Node |
|---------|------|-----------------|
| Head creation | Instant | Requires on-chain TX (~5 ADA locked) |
| Update acceptance | Instant | Requires multi-party signatures |
| State persistence | In-memory | On-chain + local ledger |
| Finalization | Simulated TX | Real on-chain TX with dispute window |
| Multi-party | Single node | Multiple nodes required |
| Network | Localhost | Cardano mainnet/testnet |
| Setup time | 1 minute | Several hours |
| Cost | Free | 5-10 ADA per head |

## Architecture

```
┌─────────────────────────────────────┐
│         Backend API                 │
│  (src/services/hydraClient.js)     │
└──────────────┬──────────────────────┘
               │
               │ HTTP (port 4001)
               │
┌──────────────▼──────────────────────┐
│       Mock Hydra Server             │
│  (mock-hydra/index.js)              │
│  ┌───────────────────────────────┐  │
│  │  In-Memory Storage            │  │
│  │  - heads: Map<headId, state>  │  │
│  │  - Snapshots history          │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

Real Production:
┌──────────────────────────────────────┐
│  Real Hydra Node (port 4001)         │
│  ├─ Cardano Node Connection          │
│  ├─ Multi-party Consensus            │
│  ├─ On-chain Finalization            │
│  └─ Dispute Resolution               │
└──────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
MOCK_HYDRA_PORT=4001  # Server port (default: 4001)
```

### Backend Configuration

In your main app's `.env`:
```bash
HYDRA_RPC_BASE=http://localhost:4001  # Points to mock server
HYDRA_RPC_KEY=  # Not needed for mock (required for real node)
```

## Production Migration

When ready to use real Hydra node:

1. Set up cardano-node
2. Set up hydra-node
3. Open Hydra head on-chain (costs ADA)
4. Update `.env`:
   ```bash
   HYDRA_RPC_BASE=http://your-hydra-node:4001
   HYDRA_RPC_KEY=your-api-key
   ```
5. Stop mock-hydra server
6. **No code changes needed!** Same API contract.

## TODOs for Production

- [ ] Replace mock with real hydra-node connection
- [ ] Implement multi-party signature verification
- [ ] Add dispute resolution handling
- [ ] Implement proper on-chain finalization
- [ ] Add mTLS authentication for hydra-node RPC
- [ ] Handle network failures and reconnection
- [ ] Add proper logging and monitoring
- [ ] Implement rate limiting
- [ ] Add contestation period handling

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 4001
netstat -ano | findstr :4001  # Windows
lsof -i :4001                  # Linux/Mac

# Kill process or change port
set MOCK_HYDRA_PORT=4002
npm start
```

### Cannot Connect from Backend
Check firewall settings and ensure:
- Mock server is running
- Backend `.env` has correct `HYDRA_RPC_BASE`
- Port 4001 is not blocked

## Security Notes

⚠️ **This is a development tool only!**

- No authentication (real hydra-node requires API keys)
- No signature verification (real hydra-node verifies all parties)
- In-memory storage (real hydra-node persists to disk)
- Single node (real Hydra requires multiple parties)
- No dispute resolution (real Hydra has contestation periods)

**Never use in production!**

## License

MIT

## Support

For issues with mock server: Check console logs for errors
For real Hydra setup: See https://hydra.family/head-protocol/
