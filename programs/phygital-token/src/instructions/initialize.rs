use anchor_lang::prelude::*;

use crate::constants::{PHYGITAL_TOKEN_SEED, ADMIN};
use crate::error::PhygitalError;
use crate::state::PhygitalToken;
use crate::utils::secp256r1_pda_seed;
use crate::{PhygitalTokenType, Secp256r1Pubkey};

#[event]
pub struct InitializeEvent {
    pub authority: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub owner: Pubkey,
    pub token_type: PhygitalTokenType,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeArgs {
    pub identifier: Secp256r1Pubkey,
    pub secp256r1_pubkey: Secp256r1Pubkey,
    pub token_type: PhygitalTokenType,
    pub owner: Pubkey
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(
        mut,
        address = ADMIN @ PhygitalError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = PhygitalToken::LEN,
        seeds = [PHYGITAL_TOKEN_SEED, secp256r1_pda_seed(&args.secp256r1_pubkey)],
        bump,
    )]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    let mut token = ctx.accounts.phygital_token.load_init()?;
    token.init(args.identifier, args.token_type, args.secp256r1_pubkey, args.owner);

    emit!(InitializeEvent {
        identifier: args.identifier,
        authority: ctx.accounts.authority.key(),
        public_key: args.secp256r1_pubkey,
        owner: args.owner,
        token_type: args.token_type
    });

    Ok(())
}
