//! The exact 32-byte challenges a tap must sign.
//!
//! Each challenge starts with its own domain tag, so a tap made for one
//! instruction can never be accepted by another. `set_owner` and
//! `pay_with_accessory` also include a recent slot hash, so they expire once
//! that slot leaves the SlotHashes sysvar (the latest 512 slots). The
//! authenticator's sign count, which must strictly increase, stops replay
//! within that window. Clients rebuild these byte for byte (see the SDK), so
//! the formats are part of the interface.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub const VERIFY_TAG: &[u8] = b"phygital-token/verify/v1";
pub const PAY_TAG: &[u8] = b"phygital-token/pay/v1";

/// WebAuthn challenge for `set_owner`:
/// `SHA256("transfer" || phygital_token || slot_hash)`.
///
/// The recipient is not part of the challenge, so the tap can happen before
/// the wallet that finishes the claim is known (handoffs). The `"transfer"`
/// tag predates the instruction's name and is kept because clients sign it.
pub fn build_set_owner_challenge(phygital_token: &Pubkey, slot_hash: [u8; 32]) -> [u8; 32] {
    hashv(&[b"transfer", phygital_token.as_ref(), &slot_hash]).to_bytes()
}

/// WebAuthn challenge for `verify`: `SHA256("phygital-token/verify/v1" || message_hash)`.
pub fn build_verify_challenge(message_hash: &[u8; 32]) -> [u8; 32] {
    hashv(&[VERIFY_TAG, message_hash]).to_bytes()
}

/// WebAuthn challenge for `pay_with_accessory`:
/// `SHA256("phygital-token/pay/v1" || slot_hash || merchant || mint || destination || amount_le || reference)`.
///
/// It names neither the accessory nor the source account, so a merchant can
/// build it before knowing which accessory will be tapped: the precompile's
/// public key identifies the accessory, and the program picks the owner's
/// delegated account the submitter names.
pub fn build_pay_challenge(
    slot_hash: &[u8; 32],
    merchant: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    amount: u64,
    reference: &Pubkey,
) -> [u8; 32] {
    hashv(&[
        PAY_TAG,
        slot_hash,
        merchant.as_ref(),
        mint.as_ref(),
        destination.as_ref(),
        &amount.to_le_bytes(),
        reference.as_ref(),
    ])
    .to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    /// Shared with the JS SDK's challenge tests.
    #[test]
    fn pay_challenge_vector() {
        let challenge =
            build_pay_challenge(&[7; 32], &key(1), &key(2), &key(3), 1_500_000, &key(4));
        assert_eq!(
            challenge,
            hashv(&[
                b"phygital-token/pay/v1",
                &[7; 32],
                &[1; 32],
                &[2; 32],
                &[3; 32],
                &1_500_000u64.to_le_bytes(),
                &[4; 32],
            ])
            .to_bytes()
        );
    }

    #[test]
    fn verify_challenge_is_tagged() {
        assert_ne!(build_verify_challenge(&[9; 32]), [9; 32]);
        assert_eq!(
            build_verify_challenge(&[9; 32]),
            hashv(&[b"phygital-token/verify/v1", &[9; 32]]).to_bytes()
        );
    }
}
