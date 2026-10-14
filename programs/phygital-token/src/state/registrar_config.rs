//! The merchant registrar, a singleton PDA at `[REGISTRAR_SEED]`, set by the
//! admin. Kept apart from `AdminConfig` so that account's layout never changes.

use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct RegistrarConfig {
    pub bump: u8,
    /// Registers, updates, suspends and closes merchants.
    pub registrar: Pubkey,
}
