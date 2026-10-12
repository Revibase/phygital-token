use anchor_lang::prelude::*;
use anchor_lang::system_program::{assign, transfer, Assign, Transfer};

use crate::constants::{POLICY_SEED, WALLET_SEED};
use crate::error::PhygitalError;
use crate::policy::{AccessoryPolicy, PolicyAction};
use crate::state::PhygitalToken;

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// Created if missing.
    /// CHECK: seeds-checked.
    #[account(mut, seeds = [POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl UpdatePolicy<'_> {
    /// Rent freed by removing entries stays in the account until it closes.
    pub fn handler(ctx: Context<Self>, actions: Vec<PolicyAction>) -> Result<()> {
        let accounts = &ctx.accounts;
        let token_key = accounts.phygital_token.key();
        let info = accounts.policy.to_account_info();
        let exists = *info.owner == crate::ID;
        let mut policy = if exists {
            AccessoryPolicy::try_deserialize(&mut &info.try_borrow_data()?[..])?
        } else {
            let wallet_bump = accounts.phygital_token.load()?.wallet_bump;
            AccessoryPolicy {
                phygital_token: token_key,
                wallet: Pubkey::create_program_address(
                    &[WALLET_SEED, token_key.as_ref(), &[wallet_bump]],
                    &crate::ID,
                )
                .map_err(|_| error!(ErrorCode::ConstraintSeeds))?,
                sol_cap: None,
                mint_caps: Vec::new(),
                allowed_origins: Vec::new(),
                program_permissions: Vec::new(),
            }
        };
        policy.apply(actions, Clock::get()?.unix_timestamp)?;
        let mut bytes = Vec::new();
        policy.try_serialize(&mut bytes)?;

        let system_program = accounts.system_program.key();
        let top_up = Rent::get()?
            .minimum_balance(bytes.len())
            .saturating_sub(info.lamports());
        if top_up > 0 {
            let to = info.clone();
            let from = accounts.payer.to_account_info();
            transfer(
                CpiContext::new(system_program, Transfer { from, to }),
                top_up,
            )?;
        }
        if !exists {
            let bump = [ctx.bumps.policy];
            let seeds: &[&[&[u8]]] = &[&[POLICY_SEED, token_key.as_ref(), &bump]];
            let account_to_assign = info.clone();
            assign(
                CpiContext::new_with_signer(system_program, Assign { account_to_assign }, seeds),
                &crate::ID,
            )?;
        }
        info.resize(bytes.len())?;
        info.try_borrow_mut_data()?.copy_from_slice(&bytes);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ClosePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner @ PhygitalError::OwnerMismatch)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// The one instruction taking the typed account, which keeps
    /// `AccessoryPolicy` in the IDL.
    #[account(
        mut,
        close = wallet,
        has_one = phygital_token @ ErrorCode::ConstraintHasOne,
        has_one = wallet @ ErrorCode::ConstraintHasOne,
    )]
    pub policy: Account<'info, AccessoryPolicy>,

    /// CHECK: the policy's wallet PDA; its rent always returns there.
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,
}
