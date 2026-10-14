//! `close_phygital_token`: the admin deletes a token, and closes its spend
//! policy (rent to the token's owner).

use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, PHYGITAL_TOKEN_SEED, SPEND_POLICY_SEED};
use crate::error::PhygitalError;
use crate::spend::close_spend_policy_if_exists;
use crate::state::{AdminConfig, PhygitalToken};
use crate::webauthn::{secp256r1_pda_seed, Secp256r1Pubkey};

#[event]
pub struct ClosePhygitalTokenEvent {
    pub admin: Pubkey,
    pub rent_recipient: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
}

#[derive(Accounts)]
pub struct ClosePhygitalToken<'info> {
    pub admin: Signer<'info>,

    /// CHECK: receives the closed account's lamports; any system account is fine.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,

    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    #[account(
        mut,
        close = rent_recipient,
        seeds = [PHYGITAL_TOKEN_SEED, secp256r1_pda_seed(&phygital_token.load()?.public_key)],
        bump,
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// Closed if it exists.
    /// CHECK: seeds-checked; only closed.
    #[account(mut, seeds = [SPEND_POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub spend_policy: UncheckedAccount<'info>,

    /// Receives the spend policy's rent; must be the token's owner when the
    /// policy exists.
    /// CHECK: compared with the token's owner below.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
}

impl ClosePhygitalToken<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let token = ctx.accounts.phygital_token.load()?;
        if *ctx.accounts.spend_policy.owner == crate::ID {
            require_keys_eq!(
                ctx.accounts.owner.key(),
                token.owner,
                PhygitalError::OwnerMismatch
            );
            close_spend_policy_if_exists(
                &ctx.accounts.spend_policy.to_account_info(),
                &ctx.accounts.owner.to_account_info(),
            )?;
        }

        emit!(ClosePhygitalTokenEvent {
            admin: ctx.accounts.admin.key(),
            rent_recipient: ctx.accounts.rent_recipient.key(),
            public_key: token.public_key,
            identifier: token.identifier,
            owner: token.owner,
            mint: token.mint,
        });
        Ok(())
    }
}
