use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::constants::WALLET_SEED;
use crate::error::PhygitalError;
use crate::policy::PolicyView;
use crate::state::PhygitalToken;
use crate::wallet::{
    build_execute_challenge, execute_as_wallet, require_direct_tx, CompactInstruction,
};
use crate::webauthn::Secp256r1VerifyArgs;

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

#[derive(Accounts)]
pub struct ExecuteWithAccessory<'info> {
    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// Missing = accessory blocked.
    /// CHECK: matched to the token and wallet by `PolicyView::load`.
    #[account(mut)]
    pub policy: UncheckedAccount<'info>,

    /// Mark writable in remaining accounts if needed.
    /// CHECK: must be the wallet the policy stores.
    pub wallet: UncheckedAccount<'info>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl<'info> ExecuteWithAccessory<'info> {
    pub fn handler(
        ctx: Context<'info, Self>,
        compact_instructions: Vec<CompactInstruction>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        let accounts = ctx.accounts;
        require_direct_tx(&accounts.instructions_sysvar)?;
        let token_key = accounts.phygital_token.key();
        let view = PolicyView::load(&accounts.policy, &token_key, accounts.wallet.key)?;
        let wallet_bump = {
            let mut token = accounts.phygital_token.load_mut()?;
            token.require_accessory_may_execute()?;
            let slot_hash =
                Secp256r1VerifyArgs::fetch_slot_hash(&accounts.slot_hashes, slot_number)?;
            let challenge =
                build_execute_challenge(&token_key, &slot_hash, &compact_instructions, |i| {
                    ctx.remaining_accounts
                        .get(i)
                        .map(|a| (a.key, a.is_signer, a.is_writable))
                })?;
            let policy = accounts.policy.try_borrow_data()?;
            let origin_allowed = |origin: &[u8]| view.origin_allowed(&policy, origin);
            token.accept_assertion(secp256r1_verify_args.verify_webauthn_assertion(
                &accounts.instructions_sysvar,
                challenge,
                None,
                Some(&origin_allowed),
            )?)?;
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
        )
    }
}

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
