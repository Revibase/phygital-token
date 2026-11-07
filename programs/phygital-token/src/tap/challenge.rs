//! The exact 32-byte challenge a tap must sign for `set_owner`.
//!
//! The challenge starts with a domain tag and names a recent slot hash, so the
//! tap is only valid until the slot leaves the SlotHashes sysvar (the latest
//! 512 slots). The token's `last_slot`, which must strictly increase, stops
//! replay within that window. Clients rebuild it byte for byte (the app's
//! `set-owner.ts`), so the format is part of the interface.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

/// Wire tag for `set_owner` challenges (`b"t"`). Stable across clients.
pub const SET_OWNER_TAG: &[u8] = b"t";

/// Challenge for `set_owner`:
/// `SHA256("t" || phygital_token || recipient || slot_hash)`.
pub fn build_set_owner_challenge(
    phygital_token: &Pubkey,
    recipient: &Pubkey,
    slot_hash: [u8; 32],
) -> [u8; 32] {
    hashv(&[
        SET_OWNER_TAG,
        phygital_token.as_ref(),
        recipient.as_ref(),
        &slot_hash,
    ])
    .to_bytes()
}
