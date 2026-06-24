use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn build_transfer_message_hash(recipient: &Pubkey) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(32);
    buffer.extend_from_slice(recipient.as_ref());
    Sha256::digest(&buffer).into()
}

pub fn build_verify_message_hash(message: impl AsRef<[u8]>) -> [u8; 32] {
    Sha256::digest(message.as_ref()).into()
}
