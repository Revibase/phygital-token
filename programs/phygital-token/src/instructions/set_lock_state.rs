use anchor_lang::prelude::*;

use crate::{error::PhygitalError, Asset, Secp256r1Pubkey};

#[event]
pub struct SetLockStateEvent {
    pub public_key: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub is_locked: bool,
    pub time: i64,
}

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

    emit!(SetLockStateEvent {
        public_key: ctx.accounts.asset.public_key,
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.asset.mint,
        is_locked,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
