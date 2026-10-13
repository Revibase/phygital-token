//! `execute_with_owner`: the owner runs any instructions as the wallet PDA,
//! with no policy involved.

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::constants::WALLET_SEED;
use crate::error::PhygitalError;
use crate::state::PhygitalToken;
use crate::wallet::{execute_as_wallet, require_direct_tx, CompactInstruction};

#[derive(Accounts)]
pub struct ExecuteWithOwner<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// Mark writable in remaining accounts if needed.
    /// CHECK: seeds-checked.
    #[account(
        seeds = [WALLET_SEED, phygital_token.key().as_ref()],
        bump = phygital_token.load()?.wallet_bump,
    )]
    pub wallet: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> ExecuteWithOwner<'info> {
    pub fn handler(
        ctx: Context<'info, Self>,
        compact_instructions: Vec<CompactInstruction>,
    ) -> Result<()> {
        let accounts = ctx.accounts;
        require_direct_tx(&accounts.instructions_sysvar)?;
        let token_key = accounts.phygital_token.key();
        execute_as_wallet(
            &accounts.wallet,
            &token_key,
            accounts.phygital_token.load()?.wallet_bump,
            &[token_key],
            ctx.remaining_accounts,
            compact_instructions,
            None,
        )
    }
}
