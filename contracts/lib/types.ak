use aiken/time.{PosixTime}
use aiken/transaction.{OutputReference}
use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction/credential.{VerificationKey}

/// Actor ID representing role in healthcare system
/// 01 = Patient, 02 = Doctor, 03 = Hospital, 04 = Insurance
pub type ActorId =
  ByteArray

/// Record identifier (SHA-256 hash of IPFS CID)
pub type RecordId =
  ByteArray

/// Permission datum stored at smart contract UTxO
/// Encodes which actors can access which encrypted records
pub type PermissionDatum {
  /// SHA-256 hash of the IPFS CID containing encrypted data
  record_id: RecordId,
  /// List of authorized actor IDs (e.g., ["01", "02", "03"])
  permitted_actors: List<ActorId>,
  /// Unix timestamp (milliseconds) when permission expires
  /// Use 0 for no expiration
  expires_at: PosixTime,
  /// Owner's verification key hash (patient wallet)
  owner: Hash<Blake2b_224, VerificationKey>,
  /// NFT policy ID + asset name for unique permission token (optional)
  /// Used to prevent duplicate permission records
  nft_ref: Option<(ByteArray, ByteArray)>,
}

/// Redeemer actions for permission validator
pub type PermissionRedeemer {
  /// Grant access: Owner adds new actors to permission list
  GrantAccess {
    /// Actor IDs to add
    new_actors: List<ActorId>,
  }
  /// Revoke access: Owner removes actors from permission list
  RevokeAccess {
    /// Actor IDs to remove
    revoked_actors: List<ActorId>,
  }
  /// Verify access: Actor proves they have permission (read-only check)
  /// This doesn't modify the UTxO, just validates the actor is in the list
  VerifyAccess {
    /// Actor requesting access
    actor_id: ActorId,
  }
  /// Update expiration: Owner extends or shortens permission lifetime
  UpdateExpiration {
    /// New expiration timestamp
    new_expires_at: PosixTime,
  }
  /// Burn permission: Owner destroys the permission record entirely
  BurnPermission
}
