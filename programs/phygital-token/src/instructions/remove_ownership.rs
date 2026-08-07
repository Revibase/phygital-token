use crate::{error::PhygitalError, Asset, Secp256r1Pubkey};
use anchor_lang::prelude::*;

#[event]
pub struct RemoveOwnershipEvent {
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub time: i64,
}

#[derive(Accounts)]
pub struct RemoveOwnership<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = asset.owner.key() == owner.key() @PhygitalError::OwnerMismatch
    )]
    pub asset: Account<'info, Asset>,
}

pub fn handler(ctx: Context<RemoveOwnership>) -> Result<()> {
    ctx.accounts.asset.owner = Pubkey::default();
    ctx.accounts.asset.is_locked = false;

    emit!(RemoveOwnershipEvent {
        owner: ctx.accounts.owner.key(),
        identifier: ctx.accounts.asset.identifier,
        public_key: ctx.accounts.asset.public_key,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
