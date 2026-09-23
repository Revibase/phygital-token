use crate::{error::PhygitalError, PhygitalToken, PhygitalTokenType, Secp256r1Pubkey};
use anchor_lang::prelude::*;

#[event]
pub struct RemoveLinkedWalletEvent {
    pub linked_wallet: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

#[derive(Accounts)]
pub struct RemoveLinkedWallet<'info> {
    pub linked_wallet: Signer<'info>,
    #[account(
        mut,
        constraint = phygital_token.load()?.linked_wallet == linked_wallet.key() @ PhygitalError::LinkedWalletMismatch
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<RemoveLinkedWallet>) -> Result<()> {
    let mut token = ctx.accounts.phygital_token.load_mut()?;
    require!(
        token.token_type != PhygitalTokenType::Permanent as u8,
        PhygitalError::PermanentLinkedWalletImmutable
    );
    token.linked_wallet = Pubkey::default();
    token.is_locked = 0;

    emit!(RemoveLinkedWalletEvent {
        linked_wallet: ctx.accounts.linked_wallet.key(),
        identifier: token.identifier,
        public_key: token.public_key,
    });

    Ok(())
}
