//! `close_spend_policy`: the owner turns tap payments off for an accessory and
//! takes back the rent. Revoking the SPL delegation is separate.

use anchor_lang::prelude::*;

use crate::constants::SPEND_POLICY_SEED;
use crate::error::PhygitalError;
use crate::state::{PhygitalToken, SpendPolicy};

#[derive(Accounts)]
pub struct CloseSpendPolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    #[account(
        mut,
        close = owner,
        has_one = owner @ PhygitalError::OwnerMismatch,
        has_one = phygital_token,
        seeds = [SPEND_POLICY_SEED, phygital_token.key().as_ref()],
        bump = spend_policy.bump,
    )]
    pub spend_policy: Account<'info, SpendPolicy>,
}
