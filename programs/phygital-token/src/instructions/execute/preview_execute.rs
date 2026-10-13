//! `preview_execute`: simulates a tapped execute without a tap. It always fails,
//! with `PreviewPassed` when the policy would allow the instructions, so it can
//! never land.

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::PhygitalError;
use crate::policy::PolicyView;
use crate::state::PhygitalToken;
use crate::wallet::{execute_as_wallet, require_direct_tx, CompactInstruction};

/// Simulation only: it never lands, so nothing is writable or signed.
#[derive(Accounts)]
pub struct PreviewExecute<'info> {
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: matched to the token and wallet by `PolicyView::load`.
    pub policy: UncheckedAccount<'info>,

    /// CHECK: must be the wallet the policy stores.
    pub wallet: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> PreviewExecute<'info> {
    /// `origin` is the page that will request the tap; `None` (a native or
    /// CTAP2-direct client) skips the origin check, which can't bind those.
    pub fn handler(
        ctx: Context<'info, Self>,
        compact_instructions: Vec<CompactInstruction>,
        origin: Option<String>,
    ) -> Result<()> {
        let accounts = ctx.accounts;
        require_direct_tx(&accounts.instructions_sysvar)?;
        let token_key = accounts.phygital_token.key();
        let view = PolicyView::load(&accounts.policy, &token_key, accounts.wallet.key)?;
        if let Some(origin) = origin {
            let allowed =
                view.origin_allowed(&accounts.policy.try_borrow_data()?, origin.as_bytes())?;
            require!(allowed, PhygitalError::OriginMismatch);
        }
        let wallet_bump = {
            let token = accounts.phygital_token.load()?;
            token.require_accessory_may_execute()?;
            token.wallet_bump
        };
        execute_as_wallet(
            &accounts.wallet,
            &token_key,
            wallet_bump,
            &[token_key, accounts.policy.key()],
            ctx.remaining_accounts,
            compact_instructions,
            Some((&accounts.policy, &view)),
        )?;
        err!(PhygitalError::PreviewPassed)
    }
}
