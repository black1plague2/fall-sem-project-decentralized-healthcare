# Aiken Smart Contracts

This directory contains Aiken smart contracts for the Cardano Health Vault permission system.

## Overview

The **permission validator** (`validators/permission.ak`) is a Plutus V3 smart contract that enforces access control for encrypted medical records stored on IPFS. It provides:

- **Owner-controlled permissions**: Only the record owner (patient) can grant/revoke access
- **Actor-based access**: Supports 4 actor types (Patient, Doctor, Hospital, Insurance)
- **Expiration support**: Permissions can have time-based expiry
- **State management**: UTxO-based permission storage on-chain

## Prerequisites

Install Aiken compiler:

```bash
# Install Aiken (requires Rust)
cargo install aiken

# Or download from https://aiken-lang.org/installation-instructions
```

## Project Structure

```
contracts/
├── aiken.toml              # Aiken project configuration
├── lib/
│   └── types.ak           # Shared types (ActorId, PermissionDatum, etc.)
├── validators/
│   └── permission.ak      # Main permission validator
└── build/
    ├── plutus.json        # Compiled Plutus blueprint (auto-generated)
    └── permission.hash    # Validator script hash (auto-generated)
```

## Build Commands

```bash
# Navigate to contracts directory
cd contracts

# Check syntax and types
aiken check

# Compile to Plutus
aiken compile

# Generate script hash
aiken hash

# Run tests (if defined)
aiken test
```

## Datum Structure

```json
{
  "record_id": "sha256_hash_of_ipfs_cid",
  "permitted_actors": ["01", "02", "03"],
  "expires_at": 1735689600000,
  "owner": "verification_key_hash",
  "nft_ref": null
}
```

## Redeemer Actions

1. **GrantAccess**: Owner adds new actors to permission list
2. **RevokeAccess**: Owner removes actors from permission list
3. **VerifyAccess**: Actor proves they have permission (read-only)
4. **UpdateExpiration**: Owner changes expiration timestamp
5. **BurnPermission**: Owner destroys the permission record

## Integration with Backend

The backend (`src/services/aikenService.js`) loads the compiled Plutus script and uses it to:

1. **Create permission UTxOs**: Submit transaction with PermissionDatum when wrapping keys
2. **Verify permissions**: Check on-chain UTxO contains actor in permitted_actors list
3. **Update permissions**: Submit redeemer transactions to grant/revoke access

## Security Properties

✅ **Owner-only updates**: All state changes require owner signature  
✅ **Expiration enforcement**: Expired permissions automatically fail validation  
✅ **Immutable record ID**: Record ID cannot be changed after creation  
✅ **Actor privacy**: Off-chain clients only see their own permissions via Midnight ZK

## Development Workflow

1. **Edit contract**: Modify `validators/permission.ak`
2. **Check types**: Run `aiken check`
3. **Compile**: Run `aiken compile` to generate `build/plutus.json`
4. **Update hash**: Run `aiken hash > build/permission.hash`
5. **Restart backend**: Backend loads new hash on startup
6. **Test**: Use `scripts/testAiken.js` to verify contract behavior

## Deployment (Production)

For mainnet deployment:

```bash
# 1. Compile with mainnet network
aiken compile --trace-level silent

# 2. Deploy script to Cardano
cardano-cli transaction build \
  --tx-in <funding-utxo> \
  --tx-out <script-address>+<min-ada> \
  --tx-out-inline-datum-file datum.json \
  --change-address <owner-address> \
  --out-file tx.raw

cardano-cli transaction sign \
  --tx-body-file tx.raw \
  --signing-key-file owner.skey \
  --out-file tx.signed

cardano-cli transaction submit --tx-file tx.signed

# 3. Update backend .env with script hash
AIKEN_VALIDATOR_HASH=a1b2c3d4e5f6789012345678901234567890123456789012
```

## Testing

Mock validator hash is used in development (`a1b2c3d4e5...`). For production, generate real hash after compilation.

Run integration tests:

```bash
npm run test:aiken
```

## Resources

- [Aiken Documentation](https://aiken-lang.org)
- [Aiken Cookbook](https://aiken-lang.org/cookbook)
- [Plutus V3 Specification](https://github.com/IntersectMBO/plutus)
