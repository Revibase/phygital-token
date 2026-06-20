use anchor_lang::prelude::*;

use crate::constants::ASSET_SEED;
use crate::utils::{secp256r1_pda_seed, Secp256r1Pubkey};
use crate::{CredentialId, ID};

pub const LAST_TRANSFER_SLOT_NONE: u64 = u64::MAX;

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Clone)]
pub enum AssetType {
    Configurable,
    Fixed,
}

#[account]
pub struct Asset {
    pub asset_type: AssetType,
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub last_transfer_slot: u64,
    pub is_locked: bool,
    pub public_key: Secp256r1Pubkey,
    pub credential_id: CredentialId,
}

impl Asset {
    pub fn size() -> usize {
        8 + 1 + 32 + 32 + 8 + 1 + 33 + 64
    }

    pub fn init(
        &mut self,
        mint: Pubkey,
        owner: Pubkey,
        asset_type: AssetType,
        public_key: Secp256r1Pubkey,
        credential_id: CredentialId,
    ) {
        self.asset_type = asset_type;
        self.mint = mint;
        self.owner = owner;
        self.last_transfer_slot = LAST_TRANSFER_SLOT_NONE;
        self.is_locked = false;
        self.public_key = public_key;
        self.credential_id = credential_id;
    }
}

pub fn find_asset_pda(secp256r1_pubkey: &Secp256r1Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ASSET_SEED, secp256r1_pda_seed(secp256r1_pubkey)], &ID).0
}
