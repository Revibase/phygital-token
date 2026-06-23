use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn build_transfer_message_hash(recipient: &Pubkey) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(32);
    buffer.extend_from_slice(recipient.as_ref());
    Sha256::digest(&buffer).into()
}

pub fn build_verify_message_hash(message: &String) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(message.as_bytes().len());
    buffer.extend_from_slice(message.as_bytes());
    Sha256::digest(&buffer).into()
}

/// Binds a spend's recipient, mint, and amount into the WebAuthn challenge so a captured signature
/// cannot be redirected to a different recipient or have its amount/mint changed.
pub fn build_spend_message_hash(recipient: &Pubkey, mint: &Pubkey, amount: u64) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(32 + 32 + 8);
    buffer.extend_from_slice(recipient.as_ref());
    buffer.extend_from_slice(mint.as_ref());
    buffer.extend_from_slice(&amount.to_le_bytes());
    Sha256::digest(&buffer).into()
}
