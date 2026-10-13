//! `set_owner`: a tap makes the transaction's `recipient` signer the owner.
//!
//! Refused while the token is locked (Controlled or Permanent with an owner).
//! The tap signs [`crate::webauthn::challenge::build_set_owner_challenge`]. A
//! change of owner closes the policy.

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::constants::{POLICY_SEED, WALLET_SEED};
use crate::error::PhygitalError;
use crate::policy::close_policy_if_exists;
use crate::state::PhygitalToken;
use crate::sysvar::fetch_slot_hash;
use crate::webauthn::challenge::build_set_owner_challenge;
use crate::webauthn::{Secp256r1Pubkey, Secp256r1VerifyArgs};

#[event]
pub struct SetOwnerEvent {
    pub recipient: Pubkey,
    pub owner: Pubkey,
    pub public_key: Secp256r1Pubkey,
    pub identifier: Secp256r1Pubkey,
}

#[derive(Accounts)]
pub struct SetOwner<'info> {
    pub recipient: Signer<'info>,

    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: seeds-checked; closed if it exists.
    #[account(mut, seeds = [POLICY_SEED, phygital_token.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,

    /// CHECK: seeds-checked; receives the policy's rent when it closes.
    #[account(
        mut,
        seeds = [WALLET_SEED, phygital_token.key().as_ref()],
        bump = phygital_token.load()?.wallet_bump,
    )]
    pub wallet: UncheckedAccount<'info>,
}

impl SetOwner<'_> {
    pub fn handler(
        ctx: Context<Self>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        let mut token = ctx.accounts.phygital_token.load_mut()?;
        require!(!token.is_locked(), PhygitalError::TokenIsCurrentlyLocked);

        let slot_hash = fetch_slot_hash(&ctx.accounts.slot_hashes, slot_number)?;
        let challenge = build_set_owner_challenge(&ctx.accounts.phygital_token.key(), slot_hash);
        token.accept_assertion(secp256r1_verify_args.verify_webauthn_assertion(
            &ctx.accounts.instructions_sysvar,
            challenge,
            None,
            None,
        )?)?;

        let recipient = ctx.accounts.recipient.key();
        emit!(SetOwnerEvent {
            owner: token.owner,
            recipient,
            public_key: token.public_key,
            identifier: token.identifier,
        });

        // A new owner (a Bearer re-link) doesn't inherit the old owner's policy.
        if token.owner != recipient {
            close_policy_if_exists(&ctx.accounts.policy, &ctx.accounts.wallet)?;
        }
        token.owner = recipient;
        Ok(())
    }
}
