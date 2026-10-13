//! `execute_with_accessory`: a tap runs instructions as the wallet PDA, within
//! the owner's policy.
//!
//! The tap signs [`crate::webauthn::challenge::build_execute_challenge`], which
//! covers every inner instruction and the keys and privileges of the accounts
//! they use. Requires an owner and a policy; the policy is matched to the token
//! and wallet by the keys it stores ([`crate::policy::PolicyView::load`]).

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::policy::PolicyView;
use crate::state::PhygitalToken;
use crate::sysvar::fetch_slot_hash;
use crate::wallet::{execute_as_wallet, require_direct_tx, CompactInstruction};
use crate::webauthn::challenge::build_execute_challenge;
use crate::webauthn::Secp256r1VerifyArgs;

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
            let slot_hash = fetch_slot_hash(&accounts.slot_hashes, slot_number)?;
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
