//! `register_merchant`: the registrar records a verified merchant. The
//! merchant signs too, proving it holds the key its payments will carry.

use anchor_lang::prelude::*;

use crate::constants::{MERCHANT_SEED, REGISTRAR_SEED};
use crate::error::PhygitalError;
use crate::state::{Merchant, MerchantArgs, MerchantStatus, RegistrarConfig};

#[event]
pub struct RegisterMerchantEvent {
    pub merchant_key: Pubkey,
    pub registrar: Pubkey,
    pub payees: Vec<Pubkey>,
    pub domain: String,
    pub name: String,
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    pub registrar: Signer<'info>,

    pub merchant_key: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [REGISTRAR_SEED],
        bump = registrar_config.bump,
        has_one = registrar @ PhygitalError::UnauthorizedRegistrar,
    )]
    pub registrar_config: Account<'info, RegistrarConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + Merchant::INIT_SPACE,
        seeds = [MERCHANT_SEED, merchant_key.key().as_ref()],
        bump,
    )]
    pub merchant: Account<'info, Merchant>,

    pub system_program: Program<'info, System>,
}

impl RegisterMerchant<'_> {
    pub fn handler(ctx: Context<Self>, args: MerchantArgs) -> Result<()> {
        args.validate()?;
        let merchant_key = ctx.accounts.merchant_key.key();
        ctx.accounts.merchant.set_inner(Merchant {
            merchant_key,
            bump: ctx.bumps.merchant,
            status: MerchantStatus::Active,
            payees: args.payees.clone(),
            domain: args.domain.clone(),
            name: args.name.clone(),
            registered_at: Clock::get()?.unix_timestamp,
        });
        emit!(RegisterMerchantEvent {
            merchant_key,
            registrar: ctx.accounts.registrar.key(),
            payees: args.payees,
            domain: args.domain,
            name: args.name,
        });
        Ok(())
    }
}
