use anchor_lang::prelude::*;

use crate::utils::Secp256r1Pubkey;

#[repr(u8)]
#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Clone, Copy)]
pub enum PhygitalTokenType {
    /// Must be unlocked before transfer; re-locks after transfer.
    Controlled,
    /// Freely transferable by possession.
    Bearer,
}

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct PhygitalToken {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub last_sign_count: u32,
    pub token_type: u8,
    pub is_locked: u8,
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
    ) {
        self.identifier = identifier;
        self.token_type = token_type as u8;
        self.public_key = public_key;
    }
}
