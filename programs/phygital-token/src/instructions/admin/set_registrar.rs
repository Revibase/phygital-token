//! `set_registrar`: the admin sets the merchant registrar, creating its config
//! on first use. The key must differ from every role in `AdminConfig`.

use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, REGISTRAR_SEED};
use crate::error::PhygitalError;
use crate::spend::fit_pda;
use crate::state::{AdminConfig, RegistrarConfig};

#[event]
pub struct SetRegistrarEvent {
    pub admin: Pubkey,
    pub registrar: Pubkey,
}

#[derive(Accounts)]
pub struct SetRegistrar<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

    /// Created if missing.
    /// CHECK: seeds-checked; written below.
    #[account(mut, seeds = [REGISTRAR_SEED], bump)]
    pub registrar_config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl SetRegistrar<'_> {
    pub fn handler(ctx: Context<Self>, registrar: Pubkey) -> Result<()> {
        ctx.accounts
            .admin_config
            .load()?
            .require_unique_role_key(&registrar)?;
        let bump = ctx.bumps.registrar_config;
        let config = RegistrarConfig { bump, registrar };
        let mut bytes = Vec::with_capacity(8 + RegistrarConfig::INIT_SPACE);
        config.try_serialize(&mut bytes)?;

        let info = ctx.accounts.registrar_config.to_account_info();
        fit_pda(
            &info,
            &ctx.accounts.admin.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &[REGISTRAR_SEED, &[bump]],
            bytes.len(),
        )?;
        info.try_borrow_mut_data()?.copy_from_slice(&bytes);

        emit!(SetRegistrarEvent {
            admin: ctx.accounts.admin.key(),
            registrar,
        });
        Ok(())
    }
}
