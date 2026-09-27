use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::error::PhygitalError;
use crate::state::AdminConfig;
use crate::{PhygitalToken, Secp256r1Pubkey};

#[event]
pub struct AssignMintEvent {
    pub public_key: Secp256r1Pubkey,
    pub authority: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub mint: Pubkey,
}

#[derive(Accounts)]
pub struct AssignMint<'info> {
    pub authority: Signer<'info>,

    /// Authority must be the admin or an issuer on this config.
    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_minter(&authority.key()) @ PhygitalError::UnauthorizedAuthority,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<AssignMint>, mint: Pubkey) -> Result<()> {
    let mut token = ctx.accounts.phygital_token.load_mut()?;
    token.mint = mint;

    emit!(AssignMintEvent {
        public_key: token.public_key,
        authority: ctx.accounts.authority.key(),
        identifier: token.identifier,
        mint,
    });

    Ok(())
}
