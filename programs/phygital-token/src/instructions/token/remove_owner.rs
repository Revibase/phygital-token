//! `remove_owner`: the owner gives up the token (not allowed for Permanent
//! tokens). Closes the accessory's spend policy, rent to the owner.

use anchor_lang::prelude::*;

use crate::constants::SPEND_POLICY_SEED;
use crate::error::PhygitalError;
use crate::spend::close_spend_policy_if_exists;
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
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// Closed if it exists.
    /// CHECK: seeds-checked; only closed.
    #[account(mut, seeds = [SPEND_POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub spend_policy: UncheckedAccount<'info>,
}

impl RemoveOwner<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let mut token = ctx.accounts.phygital_token.load_mut()?;
        require!(
            token.token_type != PhygitalTokenType::Permanent as u8,
            PhygitalError::PermanentOwnerImmutable
        );
        token.owner = Pubkey::default();
        close_spend_policy_if_exists(
            &ctx.accounts.spend_policy.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
        )?;

        emit!(RemoveOwnerEvent {
            owner: ctx.accounts.owner.key(),
            identifier: token.identifier,
            public_key: token.public_key,
        });
        Ok(())
    }
}
