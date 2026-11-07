//! The program-wide role registry, a singleton PDA at `[ADMIN_CONFIG_SEED]`.
//!
//! - `admin`: sets the other roles and may close tokens.
//! - `issuer`: creates tokens (`initialize`), choosing their passkey, type and
//!   initial owner.
//!
//! The two keys are always distinct and never the default key. Both are
//! trusted (README, "Trust assumptions").

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct AdminConfig {
    pub bump: u8,
    pub admin: Pubkey,
    pub issuer: Pubkey,
    pub _reserved: [u8; 32],
}

impl AdminConfig {
    pub const LEN: usize = 8 + core::mem::size_of::<Self>();

    pub fn is_admin(&self, key: &Pubkey) -> bool {
        self.admin == *key
    }

    pub fn is_issuer(&self, key: &Pubkey) -> bool {
        self.issuer == *key
    }

    pub fn require_unique_role_key(&self, key: &Pubkey) -> Result<()> {
        require!(
            key != &Pubkey::default(),
            PhygitalError::UnauthorizedAuthority
        );
        require!(
            !self.is_admin(key) && !self.is_issuer(key),
            PhygitalError::KeyAlreadyExists
        );
        Ok(())
    }
}
