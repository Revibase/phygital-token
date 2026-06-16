use anchor_lang::prelude::*;

use crate::constants::{CARD_INSTANCE_SEED};
use crate::utils::{secp256r1_pda_seed, Secp256r1Pubkey};

pub const LAST_TRANSFER_SLOT_NONE: u64 = u64::MAX;

#[account]
#[derive(InitSpace)]
pub struct CardInstance {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub last_transfer_slot: u64,
}

impl CardInstance {
    pub fn init(&mut self, mint: Pubkey, owner: Pubkey) {
        self.mint = mint;
        self.owner = owner;
        self.last_transfer_slot = LAST_TRANSFER_SLOT_NONE;
    }
}

pub fn find_card_instance_pda(
    secp256r1_pubkey: &Secp256r1Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CARD_INSTANCE_SEED, secp256r1_pda_seed(secp256r1_pubkey)],
        program_id,
    )
}
