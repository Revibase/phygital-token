use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::error::PhygitalError;
use crate::state::AdminConfig;

#[event]
pub struct SetMinterEvent {
    pub admin: Pubkey,
    pub minter: Pubkey,
}

#[derive(Accounts)]
pub struct SetMinter<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,
}

pub fn handler(ctx: Context<SetMinter>, minter: Pubkey) -> Result<()> {
    ctx.accounts.admin_config.load_mut()?.set_minter(minter)?;

    emit!(SetMinterEvent {
        admin: ctx.accounts.admin.key(),
        minter,
    });

    Ok(())
}
