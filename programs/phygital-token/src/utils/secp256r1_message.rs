use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn build_transfer_message_hash(sender: &Pubkey) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(32);
    buffer.extend_from_slice(sender.as_ref());
    Sha256::digest(&buffer).into()
}

pub fn build_verify_message_hash(message: &String) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(message.as_bytes().len());
    buffer.extend_from_slice(message.as_bytes());
    Sha256::digest(&buffer).into()
}
