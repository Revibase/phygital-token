use anchor_lang::prelude::*;

use crate::constants::{ASSET_SEED, INITIALIZE_AUTHORITY};
use crate::error::PhygitalError;
use crate::state::Asset;
use crate::utils::secp256r1_pda_seed;
use crate::{AssetType, Secp256r1Pubkey};

#[event]
pub struct InitializeEvent {
    pub authority: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
    pub time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeArgs {
    pub identifier: Secp256r1Pubkey,
    pub secp256r1_pubkey: Secp256r1Pubkey,
    pub asset_type: AssetType,
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(
        mut,
        address = INITIALIZE_AUTHORITY @ PhygitalError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Asset::size(),
        seeds = [ASSET_SEED, secp256r1_pda_seed(&args.secp256r1_pubkey)],
        bump,
    )]
    pub asset: Account<'info, Asset>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    ctx.accounts
        .asset
        .init(args.identifier, args.asset_type, args.secp256r1_pubkey);

    emit!(InitializeEvent {
        identifier: ctx.accounts.asset.identifier,
        authority: ctx.accounts.authority.key(),
        public_key: args.secp256r1_pubkey,
        time: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
