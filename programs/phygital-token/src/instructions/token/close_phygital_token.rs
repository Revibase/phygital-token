//! `close_phygital_token`: the admin deletes a token and its policy.

use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, PHYGITAL_TOKEN_SEED, POLICY_SEED};
use crate::error::PhygitalError;
use crate::policy::close_policy_if_exists;
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

/// The wallet PDA's assets stay and return if the same passkey is re-initialized.
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

    /// CHECK: seeds-checked; closed to `rent_recipient` if it exists, since
    /// the wallet PDA is unreachable once its token is gone.
    #[account(mut, seeds = [POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,
}

impl ClosePhygitalToken<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        close_policy_if_exists(&ctx.accounts.policy, &ctx.accounts.rent_recipient)?;
        let token = ctx.accounts.phygital_token.load()?;

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
