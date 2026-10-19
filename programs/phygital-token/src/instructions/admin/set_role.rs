//! `set_admin`, `set_issuer`, `set_minter`: the admin replaces one role key.
//! The new key must differ from all three current role keys and from the
//! default key.

use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::error::PhygitalError;
use crate::state::AdminConfig;

#[event]
pub struct SetAdminEvent {
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct SetIssuerEvent {
    pub admin: Pubkey,
    pub issuer: Pubkey,
}

#[event]
pub struct SetMinterEvent {
    pub admin: Pubkey,
    pub minter: Pubkey,
}

#[derive(Accounts)]
pub struct SetRole<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_admin(&admin.key()) @ PhygitalError::UnauthorizedAdmin,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,
}

impl SetRole<'_> {
    pub fn set_admin(ctx: Context<Self>, new_admin: Pubkey) -> Result<()> {
        let mut config = ctx.accounts.admin_config.load_mut()?;
        config.require_unique_role_key(&new_admin)?;
        let previous_admin = core::mem::replace(&mut config.admin, new_admin);
        emit!(SetAdminEvent {
            previous_admin,
            new_admin,
        });
        Ok(())
    }

    pub fn set_issuer(ctx: Context<Self>, issuer: Pubkey) -> Result<()> {
        let mut config = ctx.accounts.admin_config.load_mut()?;
        config.require_unique_role_key(&issuer)?;
        config.issuer = issuer;
        emit!(SetIssuerEvent {
            admin: ctx.accounts.admin.key(),
            issuer,
        });
        Ok(())
    }

    pub fn set_minter(ctx: Context<Self>, minter: Pubkey) -> Result<()> {
        let mut config = ctx.accounts.admin_config.load_mut()?;
        config.require_unique_role_key(&minter)?;
        config.minter = minter;
        emit!(SetMinterEvent {
            admin: ctx.accounts.admin.key(),
            minter,
        });
        Ok(())
    }
}
