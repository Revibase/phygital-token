use crate::{error::PhygitalError, PhygitalToken, Secp256r1Pubkey};
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
        constraint = token.owner.key() == owner.key() @PhygitalError::OwnerMismatch
    )]
    pub token: Account<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<RemoveOwnership>) -> Result<()> {
    ctx.accounts.token.owner = Pubkey::default();
    ctx.accounts.token.is_locked = false;

    emit!(RemoveOwnershipEvent {
        owner: ctx.accounts.owner.key(),
        identifier: ctx.accounts.token.identifier,
        public_key: ctx.accounts.token.public_key,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
