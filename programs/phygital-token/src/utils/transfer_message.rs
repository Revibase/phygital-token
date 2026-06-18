use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

/// Message digest the passkey signs to authorize a transfer.
///
/// Intentionally binds only `asset` and `sender` — the **recipient is not
/// part of the signed message**. This is a deliberate bearer/claim model: a valid
/// passkey signature authorizes moving the asset away from its current owner, and
/// whoever submits the transaction (and signs as `recipient`) claims it. As a
/// consequence, a signature observed in the mempool can be claimed by a different
/// recipient (front-running). Do not change this without also binding the recipient
/// here and in the client challenge construction.
pub fn build_transfer_message_hash(asset: &Pubkey, sender: &Pubkey) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(64);
    buffer.extend_from_slice(asset.as_ref());
    buffer.extend_from_slice(sender.as_ref());
    Sha256::digest(&buffer).into()
}
