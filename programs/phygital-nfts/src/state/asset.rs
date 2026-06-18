use anchor_lang::prelude::*;

use crate::constants::ASSET_SEED;
use crate::utils::{secp256r1_pda_seed, Secp256r1Pubkey};
use crate::ID;

pub const LAST_TRANSFER_SLOT_NONE: u64 = u64::MAX;

#[account]
pub struct Asset {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub domain_config: Pubkey,
    pub last_transfer_slot: u64,
    pub is_locked: Option<bool>,
}

impl Asset {
    pub fn size() -> usize {
        8 + 32 + 32 + 32 + 8 + 1 + 1
    }
    pub fn init(
        &mut self,
        mint: Pubkey,
        owner: Pubkey,
        domain_config: Pubkey,
        is_locked: Option<bool>,
    ) {
        self.mint = mint;
        self.owner = owner;
        self.domain_config = domain_config;
        self.last_transfer_slot = LAST_TRANSFER_SLOT_NONE;
        self.is_locked = is_locked;
    }
}

pub fn find_asset_pda(secp256r1_pubkey: &Secp256r1Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ASSET_SEED, secp256r1_pda_seed(secp256r1_pubkey)], &ID).0
}
