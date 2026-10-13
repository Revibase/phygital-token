//! The owner's rules for the accessory wallet, a PDA at
//! `[POLICY_SEED, phygital_token]`.
//!
//! No policy means the accessory cannot execute at all. The owner creates and
//! edits it with `update_policy` and can delete it with `close_policy`; any
//! change of owner closes it (`close_policy_if_exists`), so a new owner never
//! inherits the previous owner's grants.
//!
//! The execute path reads this account in place rather than deserializing it;
//! see [`crate::policy::PolicyView`] for the byte layout it relies on.

use anchor_lang::prelude::*;

use crate::policy::ProgramPermission;

/// Any instruction that changes `phygital_token.owner` must call
/// `close_policy_if_exists`.
#[account]
#[derive(Debug)]
pub struct AccessoryPolicy {
    pub phygital_token: Pubkey,
    pub wallet: Pubkey,
    pub sol_cap: Option<SpendCap>,
    pub mint_caps: Vec<MintCap>,
    /// Empty = any. Only binds browser taps: a client talking CTAP2 to the
    /// accessory directly writes its own `clientDataJSON.origin`.
    pub allowed_origins: Vec<String>,
    pub program_permissions: Vec<ProgramPermission>,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    bytemuck::Pod,
    bytemuck::Zeroable,
)]
#[repr(C)]
pub struct SpendCap {
    pub cap: u64,
    pub remaining: u64,
    pub last_reset: i64,
    /// `0` = a lifetime cap.
    pub window_seconds: i64,
    /// `0` = no per-execute limit.
    pub max_per_tx: u64,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    bytemuck::Pod,
    bytemuck::Zeroable,
)]
#[repr(C)]
pub struct MintCap {
    pub mint: Pubkey,
    pub cap: SpendCap,
}

// Borsh encodes `SpendCap` / `MintCap` exactly as their `repr(C)` bytes, which
// is what lets `PolicyView` read and write them in place.
const _: () = assert!(core::mem::size_of::<SpendCap>() == 40);
const _: () = assert!(core::mem::size_of::<MintCap>() == 72);
