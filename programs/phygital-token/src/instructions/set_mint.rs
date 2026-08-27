use anchor_lang::prelude::*;

use crate::{PhygitalToken, ADMIN, Secp256r1Pubkey, error::PhygitalError};

#[event]
pub struct SetMintEvent {
    pub public_key: Secp256r1Pubkey,
    pub authority: Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub mint: Pubkey,
    pub time: i64,
}

#[derive(Accounts)]
pub struct SetMint<'info> {
    #[account(
        address = ADMIN @ PhygitalError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,
    #[account(
        mut,
    )]
    pub phygital_token: Account<'info, PhygitalToken>,
}

pub fn handler(ctx: Context<SetMint>, mint: Pubkey) -> Result<()> {
   ctx.accounts.phygital_token.mint = mint;

    emit!(SetMintEvent {
        public_key: ctx.accounts.phygital_token.public_key,
        authority: ctx.accounts.authority.key(),
        identifier: ctx.accounts.phygital_token.identifier,
        mint,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
