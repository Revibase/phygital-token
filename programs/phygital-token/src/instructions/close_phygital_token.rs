use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, PHYGITAL_TOKEN_SEED};
use crate::error::PhygitalError;
use crate::state::{AdminConfig, PhygitalToken};
use crate::utils::secp256r1_pda_seed;
use crate::Secp256r1Pubkey;

#[event]
pub struct ClosePhygitalTokenEvent {
    pub admin: Pubkey,
    pub rent_recipient: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub linked_wallet: Pubkey,
    pub mint: Pubkey,
}

/// Admin closes a phygital token PDA and reclaims its rent.
///
/// Seeds are checked against the account's stored passkey so only a real
/// program PDA can be closed. Lamports go to `rent_recipient` (often the admin).
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
}

pub fn handler(ctx: Context<ClosePhygitalToken>) -> Result<()> {
    let token = ctx.accounts.phygital_token.load()?;

    emit!(ClosePhygitalTokenEvent {
        admin: ctx.accounts.admin.key(),
        rent_recipient: ctx.accounts.rent_recipient.key(),
        public_key: token.public_key,
        identifier: token.identifier,
        linked_wallet: token.linked_wallet,
        mint: token.mint,
    });

    Ok(())
}
