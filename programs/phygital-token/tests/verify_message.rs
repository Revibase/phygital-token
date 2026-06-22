mod common;

use phygital_token::utils::build_verify_message_hash;
use sha2::{Digest, Sha256};

#[test]
fn verify_message_hash_is_deterministic() {
    let message = "hello from the passkey".to_string();

    let hash = build_verify_message_hash(&message);
    let hash_again = build_verify_message_hash(&message);

    assert_eq!(hash, hash_again);
}

#[test]
fn verify_message_hash_changes_when_message_changes() {
    let message_a = "first message".to_string();
    let message_b = "second message".to_string();

    let hash_a = build_verify_message_hash(&message_a);
    let hash_b = build_verify_message_hash(&message_b);

    assert_ne!(hash_a, hash_b);
}

#[test]
fn verify_message_hash_golden_vector() {
    let message = "phygital verify".to_string();
    let expected: [u8; 32] = Sha256::digest(message.as_bytes()).into();

    let hash = build_verify_message_hash(&message);
    assert_eq!(hash, expected);
}
