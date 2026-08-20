use anchor_lang::prelude::*;

use crate::utils::Secp256r1Pubkey;

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Clone)]
pub enum PhygitalTokenType {
    /// Must be unlocked before transfer; re-locks after transfer.
    Controlled,
    /// Freely transferable by possession.
    Bearer,
}

#[account]
pub struct PhygitalToken {
    pub token_type: PhygitalTokenType,
    pub owner: Pubkey,
    pub last_sign_count: u32,
    pub is_locked: bool,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub mint: Pubkey,
}

impl PhygitalToken {
    pub fn size() -> usize {
        8 + 1 + 32 + 4 + 1 + 33 + 33 + 32
    }

    pub fn init(
        &mut self,
        identifier: Secp256r1Pubkey,
        asset_type: PhygitalTokenType,
        public_key: Secp256r1Pubkey,
    ) {
        self.identifier = identifier;
        self.token_type = asset_type;
        self.owner = Pubkey::default();
        self.last_sign_count = 0;
        self.is_locked = false;
        self.public_key = public_key;
        self.mint = Pubkey::default();
    }
}
