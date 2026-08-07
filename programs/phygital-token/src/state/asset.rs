use anchor_lang::prelude::*;

use crate::utils::Secp256r1Pubkey;

pub const LAST_TRANSFER_SLOT_NONE: u64 = u64::MAX;

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Clone)]
pub enum AssetType {
    /// Has a lock that the holder must release (`set_lock_state`) before transfer;
    /// re-locks automatically after each transfer.
    Lockable,
    /// Freely transferable; whoever holds the physical item owns the asset. No lock.
    Transferable,
}

#[account]
pub struct Asset {
    pub asset_type: AssetType,
    pub owner: Pubkey,
    pub last_transfer_slot: u64,
    pub is_locked: bool,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

impl Asset {
    pub fn size() -> usize {
        8 + 1 + 32 + 8 + 1 + 33 + 33
    }

    pub fn init(
        &mut self,
        identifier: Secp256r1Pubkey,
        asset_type: AssetType,
        public_key: Secp256r1Pubkey,
    ) {
        self.identifier = identifier;
        self.asset_type = asset_type;
        self.owner = Pubkey::default();
        self.last_transfer_slot = LAST_TRANSFER_SLOT_NONE;
        self.is_locked = false;
        self.public_key = public_key;
    }
}
