//! One account per physical accessory, a PDA at
//! `[PHYGITAL_TOKEN_SEED, x(passkey public key)]`.
//!
//! Records the accessory's passkey, its owner (if any), its type and the last
//! accepted WebAuthn sign count. The sign count strictly increases with every
//! accepted tap, which is what makes each assertion single-use.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::webauthn::Secp256r1Pubkey;

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
    pub bump: u8,
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
        bump: u8,
    ) -> Result<()> {
        require!(
            (token_type == PhygitalTokenType::Permanent) == (owner != Pubkey::default()),
            PhygitalError::PermanentOwnerRequired
        );

        self.identifier = identifier;
        self.token_type = token_type as u8;
        self.public_key = public_key;
        self.owner = owner;
        self.bump = bump;
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
}

// Zero-copy layout: owner 32 + mint 32 + sign count 4 + type 1 + bump 1 +
// public key 33 + identifier 33, with no padding (alignment 4 from the u32).
const _: () = assert!(core::mem::size_of::<PhygitalToken>() == 136);
