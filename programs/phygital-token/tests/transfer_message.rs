mod common;

use anchor_lang::prelude::Pubkey;
use phygital_token::utils::build_transfer_message_hash;
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_message_hash_is_asset_and_sender_only() {
    let asset = Keypair::new().pubkey();
    let sender = Keypair::new().pubkey();

    let hash = build_transfer_message_hash(&asset, &sender);
    let hash_again = build_transfer_message_hash(&asset, &sender);

    assert_eq!(hash, hash_again);
}

#[test]
fn transfer_message_hash_changes_when_sender_changes() {
    let asset = Keypair::new().pubkey();
    let sender_a = Keypair::new().pubkey();
    let sender_b = Keypair::new().pubkey();

    let hash_a = build_transfer_message_hash(&asset, &sender_a);
    let hash_b = build_transfer_message_hash(&asset, &sender_b);

    assert_ne!(hash_a, hash_b);
}

#[test]
fn transfer_message_hash_changes_when_asset_changes() {
    let asset_a = Keypair::new().pubkey();
    let asset_b = Keypair::new().pubkey();
    let sender = Keypair::new().pubkey();

    let hash_a = build_transfer_message_hash(&asset_a, &sender);
    let hash_b = build_transfer_message_hash(&asset_b, &sender);

    assert_ne!(hash_a, hash_b);
}

#[test]
fn transfer_message_hash_golden_vector() {
    let asset = Pubkey::new_from_array([1u8; 32]);
    let sender = Pubkey::new_from_array([2u8; 32]);

    let mut preimage = Vec::with_capacity(64);
    preimage.extend_from_slice(asset.as_ref());
    preimage.extend_from_slice(sender.as_ref());
    let expected: [u8; 32] = Sha256::digest(&preimage).into();

    let hash = build_transfer_message_hash(&asset, &sender);
    assert_eq!(hash, expected);
}
