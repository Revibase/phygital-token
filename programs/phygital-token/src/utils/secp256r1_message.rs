use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::utils::ActionType;

/// WebAuthn challenge for `transfer_ownership`:
/// `SHA256("transfer" || phygital_token || slot_hash)`.
pub fn build_transfer_challenge(phygital_token: &Pubkey, slot_hash: [u8; 32]) -> [u8; 32] {
    hashv(&[
        ActionType::Transfer.to_bytes(),
        phygital_token.as_ref(),
        &slot_hash,
    ])
    .to_bytes()
}
