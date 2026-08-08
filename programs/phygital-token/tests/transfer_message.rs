mod common;

use anchor_lang::prelude::Pubkey;
use phygital_token::utils::build_transfer_challenge;
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_challenge_is_deterministic() {
    let asset = Keypair::new().pubkey();
    let slot_hash = [7u8; 32];

    let hash = build_transfer_challenge(&asset, slot_hash);
    let hash_again = build_transfer_challenge(&asset, slot_hash);

    assert_eq!(hash, hash_again);
}

#[test]
fn transfer_challenge_changes_when_asset_changes() {
    let asset_a = Keypair::new().pubkey();
    let asset_b = Keypair::new().pubkey();
    let slot_hash = [7u8; 32];

    let hash_a = build_transfer_challenge(&asset_a, slot_hash);
    let hash_b = build_transfer_challenge(&asset_b, slot_hash);

    assert_ne!(hash_a, hash_b);
}

#[test]
fn transfer_challenge_changes_when_slot_hash_changes() {
    let asset = Keypair::new().pubkey();

    let hash_a = build_transfer_challenge(&asset, [1u8; 32]);
    let hash_b = build_transfer_challenge(&asset, [2u8; 32]);

    assert_ne!(hash_a, hash_b);
}

#[test]
fn transfer_challenge_golden_vector() {
    let asset = Pubkey::new_from_array([2u8; 32]);
    let slot_hash = [3u8; 32];

    let mut preimage = Vec::new();
    preimage.extend_from_slice(b"transfer");
    preimage.extend_from_slice(asset.as_ref());
    preimage.extend_from_slice(&slot_hash);
    let expected: [u8; 32] = Sha256::digest(&preimage).into();

    let hash = build_transfer_challenge(&asset, slot_hash);
    assert_eq!(hash, expected);
}
