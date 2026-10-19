//! The exact 32-byte challenges a tap must sign.
//!
//! Each challenge starts with its own domain tag, so a tap made for one
//! instruction can never be accepted by another. `set_owner` also names the
//! recipient and a recent slot hash, so the tap can only make that wallet the
//! owner, and only until the slot leaves the SlotHashes sysvar (the latest
//! 512 slots). The authenticator's sign count, which must strictly increase,
//! stops replay within that window. Clients rebuild these byte for byte (see
//! the SDK), so the formats are part of the interface.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub const VERIFY_TAG: &[u8] = b"phygital-token/verify/v1";
pub const TRANSFER_TAG: &[u8] = b"transfer";

/// WebAuthn challenge for `set_owner`:
/// `SHA256("transfer" || phygital_token || recipient || slot_hash)`.
///
/// The `"transfer"` tag predates the instruction's name and is kept because
/// clients sign it.
pub fn build_set_owner_challenge(
    phygital_token: &Pubkey,
    recipient: &Pubkey,
    slot_hash: [u8; 32],
) -> [u8; 32] {
    hashv(&[
        TRANSFER_TAG,
        phygital_token.as_ref(),
        recipient.as_ref(),
        &slot_hash,
    ])
    .to_bytes()
}

/// WebAuthn challenge for `verify`: `SHA256("phygital-token/verify/v1" || message_hash)`.
pub fn build_verify_challenge(message_hash: &[u8; 32]) -> [u8; 32] {
    hashv(&[VERIFY_TAG, message_hash]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_challenge_is_tagged() {
        assert_ne!(build_verify_challenge(&[9; 32]), [9; 32]);
        assert_eq!(
            build_verify_challenge(&[9; 32]),
            hashv(&[b"phygital-token/verify/v1", &[9; 32]]).to_bytes()
        );
    }
}
