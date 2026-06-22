mod common;

use anchor_lang::prelude::Pubkey;
use phygital_token::utils::build_transfer_message_hash;
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_message_hash_is_asset_and_sender_only() {
    let sender = Keypair::new().pubkey();

    let hash = build_transfer_message_hash(&sender);
    let hash_again = build_transfer_message_hash(&sender);

    assert_eq!(hash, hash_again);
}

#[test]
fn transfer_message_hash_changes_when_sender_changes() {
    let sender_a = Keypair::new().pubkey();
    let sender_b = Keypair::new().pubkey();

    let hash_a = build_transfer_message_hash(&sender_a);
    let hash_b = build_transfer_message_hash(&sender_b);

    assert_ne!(hash_a, hash_b);
}

#[test]
fn transfer_message_hash_golden_vector() {
    let sender = Pubkey::new_from_array([2u8; 32]);

    let mut preimage = Vec::with_capacity(32);
    preimage.extend_from_slice(sender.as_ref());
    let expected: [u8; 32] = Sha256::digest(&preimage).into();

    let hash = build_transfer_message_hash(&sender);
    assert_eq!(hash, expected);
}
