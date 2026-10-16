//! `initialize`: the issuer registers an accessory's passkey as a new token.
//!
//! The token PDA is derived from the passkey's x coordinate, so each passkey
//! maps to at most one token. Permanent tokens must get their owner here; the
//! other types must start without one.

use anchor_lang::prelude::*;

use crate::constants::{ADMIN_CONFIG_SEED, PHYGITAL_TOKEN_SEED};
use crate::error::PhygitalError;
use crate::state::{AdminConfig, PhygitalToken, PhygitalTokenType};
use crate::webauthn::{secp256r1_pda_seed, Secp256r1Pubkey};

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
    pub owner: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [ADMIN_CONFIG_SEED],
        bump = admin_config.load()?.bump,
        constraint = admin_config.load()?.is_issuer(&authority.key()) @ PhygitalError::UnauthorizedAuthority,
    )]
    pub admin_config: AccountLoader<'info, AdminConfig>,

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

impl Initialize<'_> {
    pub fn handler(ctx: Context<Self>, args: InitializeArgs) -> Result<()> {
        ctx.accounts.phygital_token.load_init()?.init(
            args.identifier,
            args.token_type,
            args.secp256r1_pubkey,
            args.owner,
            ctx.bumps.phygital_token,
        )?;

        emit!(InitializeEvent {
            identifier: args.identifier,
            authority: ctx.accounts.authority.key(),
            public_key: args.secp256r1_pubkey,
            owner: args.owner,
            token_type: args.token_type
        });
        Ok(())
    }
}
