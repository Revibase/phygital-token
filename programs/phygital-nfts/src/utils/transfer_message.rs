use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn build_transfer_message_hash(card_instance: &Pubkey, sender: &Pubkey) -> [u8; 32] {
    let mut buffer = Vec::with_capacity(64);
    buffer.extend_from_slice(card_instance.as_ref());
    buffer.extend_from_slice(sender.as_ref());
    Sha256::digest(&buffer).into()
}
