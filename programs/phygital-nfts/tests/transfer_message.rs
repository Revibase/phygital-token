mod common;

use phygital_nfts::utils::build_transfer_message_hash;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_message_hash_is_mint_and_sender_only() {
    let mint = Keypair::new().pubkey();
    let sender = Keypair::new().pubkey();

    let hash = build_transfer_message_hash(&mint, &sender);
    let hash_again = build_transfer_message_hash(&mint, &sender);

    assert_eq!(hash, hash_again);
}

#[test]
fn transfer_message_hash_changes_when_sender_changes() {
    let mint = Keypair::new().pubkey();
    let sender_a = Keypair::new().pubkey();
    let sender_b = Keypair::new().pubkey();

    let hash_a = build_transfer_message_hash(&mint, &sender_a);
    let hash_b = build_transfer_message_hash(&mint, &sender_b);

    assert_ne!(hash_a, hash_b);
}
