//! `remove_owner`: the owner gives up the token (not allowed for Permanent
//! tokens). Closes the policy.

use anchor_lang::prelude::*;

use crate::constants::{POLICY_SEED, WALLET_SEED};
use crate::error::PhygitalError;
use crate::policy::close_policy_if_exists;
use crate::state::{PhygitalToken, PhygitalTokenType};
use crate::webauthn::Secp256r1Pubkey;

#[event]
pub struct RemoveOwnerEvent {
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

#[derive(Accounts)]
pub struct RemoveOwner<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: seeds-checked; closed if it exists.
    #[account(mut, seeds = [POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,

    /// CHECK: seeds-checked; receives the policy's rent when it closes.
    #[account(
        mut,
        seeds = [WALLET_SEED, phygital_token.key().as_ref()],
        bump = phygital_token.load()?.wallet_bump,
    )]
    pub wallet: UncheckedAccount<'info>,
}

impl RemoveOwner<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let mut token = ctx.accounts.phygital_token.load_mut()?;
        require!(
            token.token_type != PhygitalTokenType::Permanent as u8,
            PhygitalError::PermanentOwnerImmutable
        );
        close_policy_if_exists(&ctx.accounts.policy, &ctx.accounts.wallet)?;
        token.owner = Pubkey::default();

        emit!(RemoveOwnerEvent {
            owner: ctx.accounts.owner.key(),
            identifier: token.identifier,
            public_key: token.public_key,
        });
        Ok(())
    }
}
