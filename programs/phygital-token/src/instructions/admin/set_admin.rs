use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::error::PhygitalError;
use crate::state::AdminConfig;

#[event]
pub struct SetAdminEvent {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[derive(Accounts)]
pub struct SetAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,
}

pub fn handler(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
    let previous_admin = ctx.accounts.admin_config.load()?.admin;
    ctx.accounts.admin_config.load_mut()?.set_admin(new_admin)?;

    emit!(SetAdminEvent {
        previous_admin,
        new_admin,
    });

    Ok(())
}
