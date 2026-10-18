//! The program-wide role registry, a singleton PDA at `[ADMIN_CONFIG_SEED]`.
//!
//! - `admin`: sets the other roles and may close tokens.
//! - `issuer`: creates tokens (`initialize`), choosing their passkey, type and
//!   initial owner.
//! - `minter`: assigns a token's `mint` (`assign_mint`).
//!
//! The three keys are always distinct and never the default key. These roles
//! are trusted; see `docs/program/THREAT_MODEL.md`.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct AdminConfig {
    pub bump: u8,
    pub admin: Pubkey,
    pub issuer: Pubkey,
    pub minter: Pubkey,
}

impl AdminConfig {
    pub const LEN: usize = 8 + core::mem::size_of::<Self>();

    pub fn is_admin(&self, key: &Pubkey) -> bool {
        self.admin == *key
    }

    pub fn is_issuer(&self, key: &Pubkey) -> bool {
        self.issuer == *key
    }

    pub fn is_minter(&self, key: &Pubkey) -> bool {
        self.minter == *key
    }

    pub fn require_unique_role_key(&self, key: &Pubkey) -> Result<()> {
        require!(
            key != &Pubkey::default(),
            PhygitalError::UnauthorizedAuthority
        );
        require!(
            !self.is_admin(key) && !self.is_issuer(key) && !self.is_minter(key),
            PhygitalError::KeyAlreadyExists
        );
        Ok(())
    }
}
