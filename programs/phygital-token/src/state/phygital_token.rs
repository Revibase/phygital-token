use anchor_lang::prelude::*;

use crate::utils::Secp256r1Pubkey;

#[repr(u8)]
#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Clone, Copy)]
pub enum PhygitalTokenType {
    /// Linked wallet must be set at initialize and can never be transferred or removed.
    Permanent,
    /// Freely transferable by possession.
    Bearer,
    /// Must be unlocked before transfer; re-locks after transfer.
    Controlled,
}

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct PhygitalToken {
    pub linked_wallet: Pubkey,
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
        linked_wallet: Pubkey,
    ) {
        self.identifier = identifier;
        self.token_type = token_type as u8;
        self.public_key = public_key;
        self.linked_wallet = linked_wallet;
        self.is_locked = (linked_wallet != Pubkey::default()) as u8;
    }
}
