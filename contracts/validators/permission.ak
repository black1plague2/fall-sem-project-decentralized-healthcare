use aiken/collection/list
use aiken/collection/dict
use aiken/crypto.{Blake2b_224, VerificationKeyHash}
use aiken/time
use aiken/transaction.{
  Input, Output, ScriptContext, Spend, Transaction, ValidityRange,
}
use aiken/transaction/credential.{Address, VerificationKey}
use aiken/transaction/value
use cardano_health_vault/types.{
  ActorId, PermissionDatum, PermissionRedeemer, GrantAccess, RevokeAccess,
  VerifyAccess, UpdateExpiration, BurnPermission,
}

/// Permission validator: Enforces access control for encrypted health records
/// 
/// Security properties:
/// 1. Only owner can grant/revoke/update permissions
/// 2. Actors can verify their access without modifying state
/// 3. Expired permissions are automatically invalid
/// 4. Owner must sign all state-changing transactions
/// 
/// Usage:
/// - Owner creates UTxO with PermissionDatum at this script address
/// - To grant access: Owner submits tx with GrantAccess redeemer
/// - To verify access: Actor queries UTxO, checks if their ID is in permitted_actors
/// - To revoke: Owner submits RevokeAccess redeemer
validator permission_validator {
  spend(
    datum_opt: Option<PermissionDatum>,
    redeemer: PermissionRedeemer,
    _own_ref: OutputReference,
    ctx: ScriptContext,
  ) -> Bool {
    // Extract transaction and validity range
    let ScriptContext { transaction, purpose } = ctx
    let Transaction { inputs, outputs, validity_range, extra_signatories, .. } =
      transaction

    // Get the datum from the spent UTxO
    expect Some(datum) = datum_opt
    let PermissionDatum {
      record_id,
      permitted_actors,
      expires_at,
      owner,
      nft_ref,
    } = datum

    // Check if permission has expired
    let is_expired =
      when expires_at is {
        0 -> False
        _ -> !time.is_between(validity_range, expires_at, expires_at + 1)
      }

    // Owner must sign state-changing transactions
    let owner_signed = list.has(extra_signatories, owner)

    when redeemer is {
      // Grant access: Add new actors to permitted list
      GrantAccess { new_actors } -> {
        // 1. Owner must sign
        expect owner_signed

        // 2. Permission must not be expired
        expect !is_expired

        // 3. Find the continuing output (same script address, updated datum)
        expect Some(continuing_output) =
          list.find(
            outputs,
            fn(output) {
              let Output { address, .. } = output
              // Check if output goes back to same script address
              when purpose is {
                Spend(own_ref) ->
                  when list.find(inputs, fn(inp) { inp.output_reference == own_ref }) is {
                    Some(own_input) -> address == own_input.output.address
                    None -> False
                  }
                _ -> False
              }
            },
          )

        // 4. Extract and validate new datum
        expect Some(new_datum_data) = continuing_output.datum
        expect new_datum: PermissionDatum = new_datum_data

        // 5. Verify only permitted_actors changed (added new actors)
        let expected_new_actors =
          list.concat(permitted_actors, new_actors)
            |> list.unique

        new_datum.record_id == record_id && new_datum.permitted_actors == expected_new_actors && new_datum.expires_at == expires_at && new_datum.owner == owner && new_datum.nft_ref == nft_ref
      }

      // Revoke access: Remove actors from permitted list
      RevokeAccess { revoked_actors } -> {
        // 1. Owner must sign
        expect owner_signed

        // 2. Find continuing output
        expect Some(continuing_output) =
          list.find(
            outputs,
            fn(output) {
              let Output { address, .. } = output
              when purpose is {
                Spend(own_ref) ->
                  when list.find(inputs, fn(inp) { inp.output_reference == own_ref }) is {
                    Some(own_input) -> address == own_input.output.address
                    None -> False
                  }
                _ -> False
              }
            },
          )

        // 3. Extract new datum
        expect Some(new_datum_data) = continuing_output.datum
        expect new_datum: PermissionDatum = new_datum_data

        // 4. Verify actors were removed
        let expected_new_actors =
          list.filter(
            permitted_actors,
            fn(actor) { !list.has(revoked_actors, actor) },
          )

        new_datum.record_id == record_id && new_datum.permitted_actors == expected_new_actors && new_datum.expires_at == expires_at && new_datum.owner == owner && new_datum.nft_ref == nft_ref
      }

      // Verify access: Read-only check (doesn't modify UTxO)
      // Note: This is primarily for testing. In production, clients read the datum directly.
      VerifyAccess { actor_id } -> {
        // 1. Permission must not be expired
        expect !is_expired

        // 2. Actor must be in permitted list
        list.has(permitted_actors, actor_id)
      }

      // Update expiration: Owner extends or shortens permission lifetime
      UpdateExpiration { new_expires_at } -> {
        // 1. Owner must sign
        expect owner_signed

        // 2. Find continuing output
        expect Some(continuing_output) =
          list.find(
            outputs,
            fn(output) {
              let Output { address, .. } = output
              when purpose is {
                Spend(own_ref) ->
                  when list.find(inputs, fn(inp) { inp.output_reference == own_ref }) is {
                    Some(own_input) -> address == own_input.output.address
                    None -> False
                  }
                _ -> False
              }
            },
          )

        // 3. Extract new datum
        expect Some(new_datum_data) = continuing_output.datum
        expect new_datum: PermissionDatum = new_datum_data

        // 4. Verify only expiration changed
        new_datum.record_id == record_id && new_datum.permitted_actors == permitted_actors && new_datum.expires_at == new_expires_at && new_datum.owner == owner && new_datum.nft_ref == nft_ref
      }

      // Burn permission: Owner destroys the permission record
      BurnPermission -> {
        // Owner must sign to burn
        owner_signed
      }
    }
  }

  else(_) {
    fail
  }
}
