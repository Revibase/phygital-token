//! `remove_owner`: the owner gives up the token (not allowed for Permanent
//! tokens).

use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::state::{PhygitalToken, PhygitalTokenType};
use crate::webauthn::Secp256r1Pubkey;

#[event]
pub struct RemoveOwnerEvent {
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

#[derive(Accounts)]
pub struct RemoveOwner<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,
}

impl RemoveOwner<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let mut token = ctx.accounts.phygital_token.load_mut()?;
        require!(
            token.token_type != PhygitalTokenType::Permanent as u8,
            PhygitalError::PermanentOwnerImmutable
        );
        token.owner = Pubkey::default();

        emit!(RemoveOwnerEvent {
            owner: ctx.accounts.owner.key(),
            identifier: token.identifier,
            public_key: token.public_key,
        });
        Ok(())
    }
}
