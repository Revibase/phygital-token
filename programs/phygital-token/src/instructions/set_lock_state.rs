use anchor_lang::prelude::*;

use crate::{error::PhygitalError, PhygitalToken, PhygitalTokenType, Secp256r1Pubkey};

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
        constraint = phygital_token.load()?.owner == owner.key() @ PhygitalError::OwnerMismatch
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<SetLockState>, is_locked: bool) -> Result<()> {
    let mut token = ctx.accounts.phygital_token.load_mut()?;
    require!(
        token.token_type == PhygitalTokenType::Controlled as u8,
        PhygitalError::TokenIsNotLockable
    );
    token.is_locked = if is_locked { 1 } else { 0 };

    emit!(SetLockStateEvent {
        public_key: token.public_key,
        owner: ctx.accounts.owner.key(),
        identifier: token.identifier,
        is_locked,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
