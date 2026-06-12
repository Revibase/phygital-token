use anchor_lang::prelude::*;

use crate::constants::MAX_METADATA_URI_LEN;
use crate::utils::LAST_TRANSFER_SLOT_NONE;

#[account]
#[derive(InitSpace)]
pub struct CardInstance {
    #[max_len(MAX_METADATA_URI_LEN)]
    pub uri: String,
    pub design_mint: Pubkey,
    pub owner: Pubkey,
    pub last_transfer_slot: u64,
}

impl CardInstance {
    pub fn init(&mut self, uri: String, design_mint: Pubkey, owner: Pubkey) {
        self.uri = uri;
        self.design_mint = design_mint;
        self.owner = owner;
        self.last_transfer_slot = LAST_TRANSFER_SLOT_NONE;
    }
}
