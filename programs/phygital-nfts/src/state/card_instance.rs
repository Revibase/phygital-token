use anchor_lang::prelude::*;

use crate::constants::MAX_METADATA_URI_LEN;
use crate::utils::LAST_TRANSFER_SLOT_NONE;

#[account]
#[derive(InitSpace)]
pub struct CardInstance {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub last_transfer_slot: u64,
    #[max_len(MAX_METADATA_URI_LEN)]
    pub uri: String,
}

impl CardInstance {
    pub fn init(&mut self, uri: String, mint: Pubkey, owner: Pubkey) {
        self.uri = uri;
        self.mint = mint;
        self.owner = owner;
        self.last_transfer_slot = LAST_TRANSFER_SLOT_NONE;
    }
}
