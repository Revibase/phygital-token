use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn build_transfer_message_hash(token_mint: &Pubkey, sender: &Pubkey) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(64);
    buffer.extend_from_slice(token_mint.as_ref());
    buffer.extend_from_slice(sender.as_ref());
    Sha256::digest(&buffer).into()
}
