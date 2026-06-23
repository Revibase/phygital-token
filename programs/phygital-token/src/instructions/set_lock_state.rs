use anchor_lang::prelude::*;

use crate::{error::PhygitalError, Asset};

#[derive(Accounts)]
pub struct SetLockState<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = asset.owner.key() == owner.key() @PhygitalError::OwnerMismatch
    )]
    pub asset: Account<'info, Asset>,
}

pub fn handler(ctx: Context<SetLockState>, is_locked: bool) -> Result<()> {
    require!(
        ctx.accounts
            .asset
            .asset_type
            .eq(&crate::AssetType::Lockable),
        PhygitalError::AssetIsNotLockable
    );
    ctx.accounts.asset.is_locked = is_locked;
    Ok(())
}
