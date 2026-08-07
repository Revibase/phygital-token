use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub fn build_transfer_message_hash(asset: &Pubkey) -> [u8; 32] {
    Sha256::digest(asset.as_ref()).into()
}
