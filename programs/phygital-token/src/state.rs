use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::webauthn::Secp256r1Pubkey;

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

#[repr(u8)]
#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Clone, Copy)]
pub enum PhygitalTokenType {
    /// Owner must be set at initialize and can never be transferred or removed.
    Permanent,
    /// Freely transferable by possession.
    Bearer,
    /// Must be unlocked before transfer; re-locks after transfer.
    Controlled,
}

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct PhygitalToken {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub last_sign_count: u32,
    pub token_type: u8,
    pub wallet_bump: u8,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

impl PhygitalToken {
    pub const LEN: usize = 8 + core::mem::size_of::<Self>();

    pub fn init(
        &mut self,
        identifier: Secp256r1Pubkey,
        token_type: PhygitalTokenType,
        public_key: Secp256r1Pubkey,
        owner: Pubkey,
        wallet_bump: u8,
    ) -> Result<()> {
        require!(
            (token_type == PhygitalTokenType::Permanent) == (owner != Pubkey::default()),
            PhygitalError::PermanentOwnerRequired
        );

        self.identifier = identifier;
        self.token_type = token_type as u8;
        self.public_key = public_key;
        self.owner = owner;
        self.wallet_bump = wallet_bump;
        Ok(())
    }

    pub fn accept_assertion(&mut self, (pubkey, sign_count): (Secp256r1Pubkey, u32)) -> Result<()> {
        require!(
            self.public_key == pubkey,
            PhygitalError::Secp256r1PubkeyMismatch
        );
        require!(
            sign_count > self.last_sign_count,
            PhygitalError::StaleSignCount
        );
        self.last_sign_count = sign_count;
        Ok(())
    }

    /// Controlled and Permanent tokens are locked whenever they have an owner;
    /// Bearer tokens never are.
    pub fn is_locked(&self) -> bool {
        self.token_type != PhygitalTokenType::Bearer as u8 && self.owner != Pubkey::default()
    }

    /// An owned Controlled or Permanent token is always locked, so this is the
    /// whole accessory lock rule.
    pub fn require_accessory_may_execute(&self) -> Result<()> {
        require_keys_neq!(self.owner, Pubkey::default(), PhygitalError::OwnerRequired);
        Ok(())
    }
}
