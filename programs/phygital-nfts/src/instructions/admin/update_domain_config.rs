use crate::{error::PhygitalError, state::DomainConfig, DOMAIN_CONFIG_SEED};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateDomainConfigArgs {
    pub new_authority: Option<Pubkey>,
    pub new_origins: Option<Vec<String>>,
}

#[derive(Accounts)]
#[instruction(args: UpdateDomainConfigArgs)]
pub struct UpdateDomainConfig<'info> {
    #[account(
        mut,
        realloc = DomainConfig::size(
            domain_config.rp_id.len(),
            DomainConfig::origins_serialized_len(&args.new_origins.as_ref().map_or(domain_config.origins.clone(), |f| f.to_vec())),
        ),
        realloc::payer = authority,
        realloc::zero = false,
        seeds = [DOMAIN_CONFIG_SEED, domain_config.rp_id_hash.as_ref()],
        bump = domain_config.bump,
    )]
    pub domain_config: Account<'info, DomainConfig>,
    #[account(
        mut,
        constraint = authority.key() == domain_config.authority @PhygitalError::AuthorityMismatch
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UpdateDomainConfig>, args: UpdateDomainConfigArgs) -> Result<()> {
    if let Some(authority) = args.new_authority {
        ctx.accounts.domain_config.authority = authority;
    }
    if let Some(origins) = args.new_origins {
        ctx.accounts.domain_config.origins = origins;
    }
    Ok(())
}
