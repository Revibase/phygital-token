//! `update_merchant` and `set_merchant_status`: the registrar changes a
//! merchant's payees, domain and name, or suspends or reinstates it.

use anchor_lang::prelude::*;

use crate::constants::{MERCHANT_SEED, REGISTRAR_SEED};
use crate::error::PhygitalError;
use crate::state::{Merchant, MerchantArgs, MerchantStatus, RegistrarConfig};

#[event]
pub struct UpdateMerchantEvent {
    pub merchant_key: Pubkey,
    pub payees: Vec<Pubkey>,
    pub domain: String,
    pub name: String,
}

#[event]
pub struct SetMerchantStatusEvent {
    pub merchant_key: Pubkey,
    pub status: MerchantStatus,
}

#[derive(Accounts)]
pub struct UpdateMerchant<'info> {
    pub registrar: Signer<'info>,

    #[account(
        seeds = [REGISTRAR_SEED],
        bump = registrar_config.bump,
        has_one = registrar @ PhygitalError::UnauthorizedRegistrar,
    )]
    pub registrar_config: Account<'info, RegistrarConfig>,

    #[account(
        mut,
        seeds = [MERCHANT_SEED, merchant.merchant_key.as_ref()],
        bump = merchant.bump,
    )]
    pub merchant: Account<'info, Merchant>,
}

impl UpdateMerchant<'_> {
    pub fn update(ctx: Context<Self>, args: MerchantArgs) -> Result<()> {
        args.validate()?;
        let merchant = &mut ctx.accounts.merchant;
        merchant.payees = args.payees.clone();
        merchant.domain = args.domain.clone();
        merchant.name = args.name.clone();
        emit!(UpdateMerchantEvent {
            merchant_key: merchant.merchant_key,
            payees: args.payees,
            domain: args.domain,
            name: args.name,
        });
        Ok(())
    }

    pub fn set_status(ctx: Context<Self>, status: MerchantStatus) -> Result<()> {
        let merchant = &mut ctx.accounts.merchant;
        merchant.status = status;
        emit!(SetMerchantStatusEvent {
            merchant_key: merchant.merchant_key,
            status,
        });
        Ok(())
    }
}
