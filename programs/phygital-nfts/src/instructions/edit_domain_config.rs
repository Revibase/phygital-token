use anchor_lang::prelude::*;

use crate::error::TokenProgramError;
use crate::state::DomainConfig;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EditDomainConfigArgs {
    pub new_origins: Option<Vec<String>>,
    pub new_royalty_bps: Option<u16>,
}

#[derive(Accounts)]
pub struct EditDomainConfig<'info> {
    #[account(mut)]
    pub domain_config: Account<'info, DomainConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<EditDomainConfig>, args: EditDomainConfigArgs) -> Result<()> {
    let domain_config = &mut ctx.accounts.domain_config;

    require!(
        domain_config.authority == ctx.accounts.authority.key(),
        TokenProgramError::OwnerMismatch
    );

    if let Some(new_origins) = args.new_origins {
        domain_config.write_origins(&new_origins)?;
    }

    if let Some(new_royalty_bps) = args.new_royalty_bps {
        require!(
            new_royalty_bps <= 10_000,
            TokenProgramError::InvalidRoyaltyBps
        );
        domain_config.royalty_bps = new_royalty_bps;
    }

    Ok(())
}
