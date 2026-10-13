//! The exact 32-byte challenge a tap must sign.
//!
//! The challenge starts with a domain tag and includes a recent slot hash, so
//! it expires once that slot leaves the SlotHashes sysvar (the latest 512
//! slots). The authenticator's sign count, which must strictly increase, stops
//! replay within that window. Clients rebuild it byte for byte (see the SDK's
//! `beginTransfer`), so the format is part of the interface.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

/// WebAuthn challenge for `set_owner`:
/// `SHA256("transfer" || phygital_token || slot_hash)`.
///
/// The recipient is not part of the challenge, so the tap can happen before
/// the wallet that finishes the claim is known (handoffs). The `"transfer"`
/// tag predates the instruction's name and is kept because clients sign it.
pub fn build_set_owner_challenge(phygital_token: &Pubkey, slot_hash: [u8; 32]) -> [u8; 32] {
    hashv(&[b"transfer", phygital_token.as_ref(), &slot_hash]).to_bytes()
}
