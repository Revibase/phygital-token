use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::error::PhygitalError;
use crate::state::AdminConfig;

#[event]
pub struct SetIssuerEvent {
    pub admin: Pubkey,
    pub issuer: Pubkey,
}

#[derive(Accounts)]
pub struct SetIssuer<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,
}

pub fn handler(ctx: Context<SetIssuer>, issuer: Pubkey) -> Result<()> {
    ctx.accounts.admin_config.load_mut()?.set_issuer(issuer)?;

    emit!(SetIssuerEvent {
        admin: ctx.accounts.admin.key(),
        issuer,
    });

    Ok(())
}
