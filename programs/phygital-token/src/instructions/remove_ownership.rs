use crate::{error::PhygitalError, PhygitalToken, Secp256r1Pubkey};
use anchor_lang::prelude::*;

#[event]
pub struct RemoveOwnershipEvent {
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

#[derive(Accounts)]
pub struct RemoveOwnership<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = phygital_token.load()?.owner == owner.key() @ PhygitalError::OwnerMismatch
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<RemoveOwnership>) -> Result<()> {
    let mut token = ctx.accounts.phygital_token.load_mut()?;
    token.owner = Pubkey::default();
    token.is_locked = 0;

    emit!(RemoveOwnershipEvent {
        owner: ctx.accounts.owner.key(),
        identifier: token.identifier,
        public_key: token.public_key,
    });

    Ok(())
}
