//! In-place access to a stored `AccessoryPolicy` for the execute path.
//!
//! Deserializing the whole policy on every execute would cost compute and heap,
//! so [`PolicyView::load`] validates the account and records where its
//! variable-length parts start. Account layout (after the 8-byte discriminator):
//!
//! | Field                 | Encoding                                  |
//! |-----------------------|-------------------------------------------|
//! | `phygital_token`      | 32 bytes at 8                             |
//! | `wallet`              | 32 bytes at 40                            |
//! | `sol_cap`             | `Option<SpendCap>` at 72 (1 + 40 bytes)   |
//! | `mint_caps`           | `u32` count, then 72 bytes per `MintCap`  |
//! | `allowed_origins`     | `u32` count, then `u32` length + bytes each |
//! | `program_permissions` | the rest; matched by [`super::matcher`]   |
//!
//! `SpendCap` and `MintCap` are `repr(C)` `Pod` types whose Borsh encoding is
//! their memory layout (asserted in `state/accessory_policy.rs`), so caps are
//! read and written with `bytemuck` at the recorded offsets.

use anchor_lang::prelude::*;

use super::reader::Reader;
use crate::state::{AccessoryPolicy, MintCap, SpendCap};

const PHYGITAL_TOKEN: usize = 8;
const WALLET: usize = 40;
const SOL_CAP: usize = 72;

/// Where the variable-length parts of a policy account start, so the execute
/// path reads and charges it in place instead of deserializing it.
pub(crate) struct PolicyView {
    sol_cap: Option<usize>,
    mint_caps: usize,
    mint_count: usize,
    origins: usize,
    permissions: usize,
}

impl PolicyView {
    /// Checks `info` is the policy of `phygital_token` and `wallet` its wallet.
    /// Policies are only created at the token's PDA, so the stored keys stand
    /// in for re-deriving both addresses.
    pub(crate) fn load(
        info: &AccountInfo,
        phygital_token: &Pubkey,
        wallet: &Pubkey,
    ) -> Result<Self> {
        require_keys_eq!(*info.owner, crate::ID, ErrorCode::AccountNotInitialized);
        let data = info.try_borrow_data()?;
        require!(
            data.starts_with(AccessoryPolicy::DISCRIMINATOR),
            ErrorCode::AccountDiscriminatorMismatch
        );
        require!(
            data.get(PHYGITAL_TOKEN..WALLET) == Some(phygital_token.as_ref()),
            ErrorCode::ConstraintHasOne
        );
        require!(
            data.get(WALLET..SOL_CAP) == Some(wallet.as_ref()),
            ErrorCode::ConstraintAddress
        );
        let mut r = Reader::new(&data, SOL_CAP);
        let sol_cap = r.option(|r| {
            let at = r.pos;
            r.take(size_of::<SpendCap>()).map(|_| at)
        })?;
        let mint_count = r.u32()? as usize;
        let mint_caps = r.pos;
        r.take(
            mint_count
                .checked_mul(size_of::<MintCap>())
                .ok_or_else(|| error!(ErrorCode::AccountDidNotDeserialize))?,
        )?;
        let origins = r.pos;
        for _ in 0..r.u32()? {
            r.bytes()?;
        }
        Ok(Self {
            sol_cap,
            mint_caps,
            mint_count,
            origins,
            permissions: r.pos,
        })
    }

    pub(crate) fn sol_cap(&self, data: &[u8]) -> Option<SpendCap> {
        self.sol_cap
            .map(|at| bytemuck::pod_read_unaligned(&data[at..at + size_of::<SpendCap>()]))
    }

    pub(crate) fn set_sol_cap(&self, data: &mut [u8], cap: &SpendCap) {
        if let Some(at) = self.sol_cap {
            data[at..at + size_of::<SpendCap>()].copy_from_slice(bytemuck::bytes_of(cap));
        }
    }

    fn mint_cap_range(&self, slot: usize) -> core::ops::Range<usize> {
        let at = self.mint_caps + slot * size_of::<MintCap>();
        at..at + size_of::<MintCap>()
    }

    pub(crate) fn mint_count(&self) -> usize {
        self.mint_count
    }

    pub(crate) fn mint_slot(&self, data: &[u8], mint: &Pubkey) -> Option<usize> {
        (0..self.mint_count).find(|&slot| data[self.mint_cap_range(slot)][..32] == *mint.as_ref())
    }

    pub(crate) fn mint_cap(&self, data: &[u8], slot: usize) -> MintCap {
        bytemuck::pod_read_unaligned(&data[self.mint_cap_range(slot)])
    }

    pub(crate) fn set_mint_cap(&self, data: &mut [u8], slot: usize, cap: &MintCap) {
        data[self.mint_cap_range(slot)].copy_from_slice(bytemuck::bytes_of(cap));
    }

    pub(crate) fn origin_allowed(&self, data: &[u8], origin: &[u8]) -> Result<bool> {
        let mut r = Reader::new(data, self.origins);
        let count = r.u32()?;
        for _ in 0..count {
            if r.bytes()? == origin {
                return Ok(true);
            }
        }
        Ok(count == 0)
    }

    pub(crate) fn permissions<'a>(&self, data: &'a [u8]) -> &'a [u8] {
        &data[self.permissions..]
    }
}
