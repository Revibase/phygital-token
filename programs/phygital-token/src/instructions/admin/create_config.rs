use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::state::AdminConfig;

#[event]
pub struct CreateConfigEvent {
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct CreateConfig<'info> {
    /// Becomes the sole admin on the singleton config. Callable once.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = AdminConfig::LEN,
        seeds = [ADMIN_CONFIG_SEED],
        bump,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateConfig>) -> Result<()> {
    let admin_config = &mut ctx.accounts.admin_config.load_init()?;
    admin_config.bump = ctx.bumps.admin_config;
    admin_config.admin = ctx.accounts.authority.key();

    emit!(CreateConfigEvent {
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
