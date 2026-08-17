use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::utils::ActionType;

/// WebAuthn challenge for `transfer_ownership`:
/// `SHA256("transfer" || asset || slot_hash)`.
pub fn build_transfer_challenge(asset: &Pubkey, slot_hash: [u8; 32]) -> [u8; 32] {
    let action = ActionType::Transfer.to_bytes();
    let mut buffer = Vec::with_capacity(action.len() + 32 + 32);
    buffer.extend_from_slice(action);
    buffer.extend_from_slice(asset.as_ref());
    buffer.extend_from_slice(&slot_hash);
    Sha256::digest(&buffer).into()
}
