use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::constants::SEED_DOMAIN_CONFIG;
use crate::error::TokenProgramError;
use crate::state::DomainConfig;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    /// WebAuthn relying party id (e.g. `example.com`).
    pub rp_id: String,
    /// `SHA256(rp_id)` — PDA seed; must match `rp_id`.
    pub rp_id_hash: [u8; 32],
    /// Allowed WebAuthn origins (e.g. `https://app.example.com`).
    pub origins: Vec<String>,
    /// Share of collection royalty paid to `authority` on paid transfers.
    pub royalty_bps: u16,
}

#[derive(Accounts)]
#[instruction(args: CreateDomainConfigArgs)]
pub struct CreateDomainConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = DomainConfig::size(),
        seeds = [SEED_DOMAIN_CONFIG, args.rp_id_hash.as_ref()],
        bump,
    )]
    pub domain_config: Account<'info, DomainConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateDomainConfig>, args: CreateDomainConfigArgs) -> Result<()> {
    require!(
        args.royalty_bps <= 10_000,
        TokenProgramError::InvalidRoyaltyBps
    );

    let expected_rp_id_hash: [u8; 32] = Sha256::digest(args.rp_id.as_bytes()).into();
    require!(
        args.rp_id_hash == expected_rp_id_hash,
        TokenProgramError::InvalidMetadata
    );

    let domain_config = &mut ctx.accounts.domain_config;
    domain_config.royalty_bps = args.royalty_bps;
    domain_config.rp_id_hash = expected_rp_id_hash;
    domain_config.write_rp_id(&args.rp_id)?;
    domain_config.write_origins(&args.origins)?;
    domain_config.authority = ctx.accounts.authority.key();
    domain_config.bump = ctx.bumps.domain_config;

    Ok(())
}
