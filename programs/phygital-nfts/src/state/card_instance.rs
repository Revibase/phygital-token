use anchor_lang::prelude::*;

use crate::constants::CARD_INSTANCE_SEED;
use crate::error::PhygitalError;
use crate::utils::{secp256r1_pda_seed, Secp256r1Pubkey};

/// Sentinel for a card that has never advanced its counter, so the first tap is accepted
/// regardless of the counter value the tag happens to emit. The NFC tag counter is at
/// most 32-bit, so reserving `u32::MAX` as the sentinel cannot collide with a real tap.
pub const LAST_COUNTER_NONE: u32 = u32::MAX;

#[account]
#[derive(InitSpace)]
pub struct CardInstance {
    pub mint: Pubkey,
    pub owner: Pubkey,
    /// Highest tap counter consumed on-chain. Each physical tap emits a strictly greater
    /// counter, so requiring `counter > last_counter` prevents replay.
    pub last_counter: u32,
}

impl CardInstance {
    pub fn init(&mut self, mint: Pubkey, owner: Pubkey) {
        self.mint = mint;
        self.owner = owner;
        self.last_counter = LAST_COUNTER_NONE;
    }

    /// Enforces strict counter monotonicity against the latest verified tap and advances
    /// the stored counter. A never-advanced card (sentinel) accepts any counter.
    pub fn advance_counter(&mut self, tap_counter: u32) -> Result<()> {
        if self.last_counter != LAST_COUNTER_NONE {
            require!(
                tap_counter > self.last_counter,
                PhygitalError::StaleTransferCounter
            );
        }
        self.last_counter = tap_counter;
        Ok(())
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
