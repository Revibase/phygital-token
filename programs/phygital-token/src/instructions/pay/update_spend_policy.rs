//! `update_spend_policy`: the owner creates or edits an accessory's tap-payment
//! limits. The account is created on first use at its PDA (funded by `payer`)
//! and resized to fit after every edit.

use anchor_lang::prelude::*;

use crate::constants::SPEND_POLICY_SEED;
use crate::error::PhygitalError;
use crate::spend::{fit_pda, SpendPolicyAction};
use crate::state::{PhygitalToken, SpendPolicy};

#[event]
pub struct UpdateSpendPolicyEvent {
    pub phygital_token: Pubkey,
    pub owner: Pubkey,
    pub actions: Vec<SpendPolicyAction>,
}

#[derive(Accounts)]
pub struct UpdateSpendPolicy<'info> {
    pub owner: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// Created if missing.
    /// CHECK: seeds-checked; deserialized below when it exists.
    #[account(mut, seeds = [SPEND_POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub spend_policy: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl UpdateSpendPolicy<'_> {
    pub fn handler(ctx: Context<Self>, actions: Vec<SpendPolicyAction>) -> Result<()> {
        let accounts = &ctx.accounts;
        let token_key = accounts.phygital_token.key();
        let owner = accounts.owner.key();
        let info = accounts.spend_policy.to_account_info();
        let bump = ctx.bumps.spend_policy;
        let mut policy = if *info.owner == crate::ID {
            SpendPolicy::try_deserialize(&mut &info.try_borrow_data()?[..])?
        } else {
            SpendPolicy {
                phygital_token: token_key,
                owner,
                bump,
                paused: false,
                reset_offset: 0,
                daily_limits: Vec::new(),
                allowed_payees: Vec::new(),
            }
        };
        // Policies are closed on every change of owner, so this always holds.
        require_keys_eq!(policy.owner, owner, PhygitalError::OwnerMismatch);

        policy.apply(actions.clone(), Clock::get()?.unix_timestamp)?;
        let mut bytes = Vec::new();
        policy.try_serialize(&mut bytes)?;
        fit_pda(
            &info,
            &accounts.payer.to_account_info(),
            &accounts.system_program.to_account_info(),
            &[SPEND_POLICY_SEED, token_key.as_ref(), &[bump]],
            bytes.len(),
        )?;
        info.try_borrow_mut_data()?.copy_from_slice(&bytes);

        emit!(UpdateSpendPolicyEvent {
            phygital_token: token_key,
            owner,
            actions,
        });
        Ok(())
    }
}
