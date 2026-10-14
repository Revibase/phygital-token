//! `close_merchant`: the registrar removes a merchant; the rent goes to the
//! merchant key.

use anchor_lang::prelude::*;

use crate::constants::{MERCHANT_SEED, REGISTRAR_SEED};
use crate::error::PhygitalError;
use crate::state::{Merchant, RegistrarConfig};

#[event]
pub struct CloseMerchantEvent {
    pub merchant_key: Pubkey,
}

#[derive(Accounts)]
pub struct CloseMerchant<'info> {
    pub registrar: Signer<'info>,

    #[account(
        seeds = [REGISTRAR_SEED],
        bump = registrar_config.bump,
        has_one = registrar @ PhygitalError::UnauthorizedRegistrar,
    )]
    pub registrar_config: Account<'info, RegistrarConfig>,

    /// CHECK: receives the rent; must be the merchant's key.
    #[account(mut)]
    pub merchant_key: UncheckedAccount<'info>,

    #[account(
        mut,
        close = merchant_key,
        has_one = merchant_key @ PhygitalError::InvalidMerchantArgs,
        seeds = [MERCHANT_SEED, merchant_key.key().as_ref()],
        bump = merchant.bump,
    )]
    pub merchant: Account<'info, Merchant>,
}

impl CloseMerchant<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        emit!(CloseMerchantEvent {
            merchant_key: ctx.accounts.merchant_key.key(),
        });
        Ok(())
    }
}
