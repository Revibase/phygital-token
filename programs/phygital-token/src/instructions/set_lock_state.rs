use anchor_lang::prelude::*;

use crate::{error::PhygitalError, PhygitalToken, Secp256r1Pubkey};

#[event]
pub struct SetLockStateEvent {
    pub public_key: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub is_locked: bool,
    pub time: i64,
}

#[derive(Accounts)]
pub struct SetLockState<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = token.owner.key() == owner.key() @PhygitalError::OwnerMismatch
    )]
    pub token: Account<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<SetLockState>, is_locked: bool) -> Result<()> {
    require!(
        ctx.accounts
            .token
            .token_type
            .eq(&crate::PhygitalTokenType::Controlled),
        PhygitalError::TokenIsNotLockable
    );
    ctx.accounts.token.is_locked = is_locked;

    emit!(SetLockStateEvent {
        public_key: ctx.accounts.token.public_key,
        owner: ctx.accounts.owner.key(),
        identifier: ctx.accounts.token.identifier,
        is_locked,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
