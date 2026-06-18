use crate::{state::DomainConfig, DOMAIN_CONFIG_SEED};
use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateDomainConfigArgs {
    pub rp_id: String,
    pub origins: Vec<String>,
    pub authority: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: CreateDomainConfigArgs)]
pub struct CreateDomainConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = DomainConfig::size(
            args.rp_id.len(),
            DomainConfig::origins_serialized_len(&args.origins),
        ),
        seeds = [DOMAIN_CONFIG_SEED, {
            Sha256::digest(args.rp_id.as_bytes()).as_ref()
        }],
        bump,
    )]
    pub domain_config: Account<'info, DomainConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateDomainConfig>, args: CreateDomainConfigArgs) -> Result<()> {
    #[cfg(feature = "mainnet")]
    require!(
        ctx.accounts.admin.key() == crate::ADMIN,
        crate::error::PhygitalError::AuthorityMismatch
    );

    let domain_config = &mut ctx.accounts.domain_config;
    domain_config.rp_id_hash = Sha256::digest(args.rp_id.as_bytes()).into();
    domain_config.rp_id = args.rp_id;
    domain_config.origins = args.origins;
    domain_config.bump = ctx.bumps.domain_config;
    domain_config.authority = args.authority;

    Ok(())
}
