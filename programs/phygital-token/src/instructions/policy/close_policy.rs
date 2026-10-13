//! `close_policy`: the owner deletes the policy, blocking the accessory again.
//! Everything is enforced by the account constraints; the rent returns to the
//! wallet.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::state::{AccessoryPolicy, PhygitalToken};

#[derive(Accounts)]
pub struct ClosePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// The one instruction taking the typed account, which keeps
    /// `AccessoryPolicy` in the IDL.
    #[account(
        mut,
        close = wallet,
        has_one = phygital_token @ ErrorCode::ConstraintHasOne,
        has_one = wallet @ ErrorCode::ConstraintHasOne,
    )]
    pub policy: Account<'info, AccessoryPolicy>,

    /// CHECK: the policy's wallet PDA; its rent always returns there.
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,
}
