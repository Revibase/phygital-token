use anchor_lang::prelude::*;

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

    fn require_unique_role_key(&self, key: &Pubkey) -> Result<()> {
        require!(
            key != &Pubkey::default(),
            crate::error::PhygitalError::UnauthorizedAuthority
        );
        require!(
            !self.is_admin(key) && !self.is_issuer(key) && !self.is_minter(key),
            crate::error::PhygitalError::KeyAlreadyExists
        );
        Ok(())
    }

    pub fn set_issuer(&mut self, key: Pubkey) -> Result<()> {
        self.require_unique_role_key(&key)?;
        self.issuer = key;
        Ok(())
    }

    pub fn set_minter(&mut self, key: Pubkey) -> Result<()> {
        self.require_unique_role_key(&key)?;
        self.minter = key;
        Ok(())
    }

    pub fn set_admin(&mut self, key: Pubkey) -> Result<()> {
        self.require_unique_role_key(&key)?;
        self.admin = key;
        Ok(())
    }
}
