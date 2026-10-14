//! `pay_with_accessory`: one tap pays a verified merchant (or a payee the owner
//! allowed) from the owner's delegated token account, within the accessory's
//! daily limit.
//!
//! The tap signs [`build_pay_challenge`], which binds the merchant, mint,
//! destination, amount and reference but not the accessory: the precompile's
//! public key must be the token's passkey, so one tap both identifies the
//! accessory and authorizes the payment. The merchant co-signs the transaction
//! with the key in the challenge, so an intercepted tap is useless to anyone
//! else. Tokens move by `transfer_checked`, signed by the owner's delegate PDA,
//! so the token program also enforces the owner's SPL allowance.

// `#[event_cpi]` adds `event_authority` and `program` as `AccountInfo`s,
// which Anchor marks deprecated.
#![allow(deprecated)]

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_SYSVAR_ID;

use crate::constants::{DELEGATE_SEED, MERCHANT_SEED, SPEND_POLICY_SEED};
use crate::error::PhygitalError;
use crate::spend::{read_token_account, require_direct_tx, transfer_as_delegate};
use crate::state::{Merchant, MerchantStatus, PhygitalToken, SpendPolicy};
use crate::sysvar::fetch_slot_hash;
use crate::webauthn::challenge::build_pay_challenge;
use crate::webauthn::Secp256r1VerifyArgs;

/// Bytes of the client-reported origin kept in the event.
const MAX_EVENT_ORIGIN_LEN: usize = 128;

#[event]
pub struct TapPaymentEvent {
    pub phygital_token: Pubkey,
    pub owner: Pubkey,
    pub merchant: Pubkey,
    /// Paid to a verified merchant's payee (otherwise an allowed payee).
    pub verified: bool,
    pub mint: Pubkey,
    pub source: Pubkey,
    pub destination: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub reference: Pubkey,
    pub remaining_today: u64,
    pub sign_count: u32,
    /// `clientDataJSON.origin` as the tapping client reported it; a hint only.
    pub origin: String,
}

#[event_cpi]
#[derive(Accounts)]
pub struct PayWithAccessory<'info> {
    #[account(mut)]
    pub phygital_token: AccountLoader<'info, PhygitalToken>,

    #[account(
        mut,
        has_one = phygital_token,
        seeds = [SPEND_POLICY_SEED, phygital_token.key().as_ref()],
        bump = spend_policy.bump,
    )]
    pub spend_policy: Account<'info, SpendPolicy>,

    /// `[DELEGATE_SEED, owner]`; signs the transfer.
    /// CHECK: derived from the token's owner in the handler (Anchor's IDL
    /// cannot express a seed read from another account's data).
    pub delegate: UncheckedAccount<'info>,

    /// Co-signs every payment; its key is part of the tap's challenge.
    pub merchant: Signer<'info>,

    /// CHECK: the merchant's registry entry, read below if it exists.
    #[account(seeds = [MERCHANT_SEED, merchant.key().as_ref()], bump)]
    pub merchant_record: UncheckedAccount<'info>,

    /// CHECK: read in place and validated below.
    #[account(mut)]
    pub source: UncheckedAccount<'info>,

    /// CHECK: owned by `token_program`; `transfer_checked` validates it.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: read in place and validated below.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    /// CHECK: any key; the merchant's order reference (Solana Pay convention).
    pub reference: UncheckedAccount<'info>,

    /// CHECK: SPL Token or Token-2022, checked below.
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: validated as the SlotHashes sysvar address
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: validated as the instructions sysvar address
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

impl PayWithAccessory<'_> {
    pub fn handler(
        ctx: Context<Self>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
        amount: u64,
        decimals: u8,
    ) -> Result<()> {
        let accounts = &ctx.accounts;
        require_direct_tx(&accounts.instructions_sysvar)?;
        require!(amount > 0, PhygitalError::ZeroAmount);

        let mut token = accounts.phygital_token.load_mut()?;
        let owner = token.owner;
        require!(owner != Pubkey::default(), PhygitalError::OwnerRequired);
        let (delegate, delegate_bump) =
            Pubkey::find_program_address(&[DELEGATE_SEED, owner.as_ref()], &crate::ID);
        require_keys_eq!(
            accounts.delegate.key(),
            delegate,
            PhygitalError::DelegateMismatch
        );
        let mut policy = (*accounts.spend_policy).clone();
        require_keys_eq!(policy.owner, owner, PhygitalError::OwnerMismatch);
        require!(!policy.paused, PhygitalError::TapPaymentsPaused);

        let token_program = accounts.token_program.key();
        let mint = accounts.mint.key();
        require!(
            *accounts.mint.owner == token_program,
            PhygitalError::InvalidTokenAccount
        );
        let source = read_token_account(&accounts.source, &token_program)?;
        require!(
            source.mint == mint && source.owner == owner,
            PhygitalError::InvalidTokenAccount
        );
        require!(
            source.delegate == Some(delegate),
            PhygitalError::DelegateMismatch
        );
        let destination = read_token_account(&accounts.destination, &token_program)?;
        require!(
            destination.mint == mint && accounts.destination.key() != accounts.source.key(),
            PhygitalError::InvalidTokenAccount
        );

        let slot_hash = fetch_slot_hash(&accounts.slot_hashes, slot_number)?;
        let challenge = build_pay_challenge(
            &slot_hash,
            &accounts.merchant.key(),
            &mint,
            &accounts.destination.key(),
            amount,
            &accounts.reference.key(),
        );
        let assertion = secp256r1_verify_args.verify_webauthn_assertion(
            &accounts.instructions_sysvar,
            challenge,
            None,
            None,
        )?;
        let sign_count = assertion.1;

        let now = Clock::get()?.unix_timestamp;
        let payee = destination.owner;
        let merchant = load_merchant(&accounts.merchant_record)?;
        let verified = merchant.as_ref().is_some_and(|m| m.accepts(&payee));
        if !verified && !policy.use_allowed_payee(&payee, now) {
            return match merchant {
                Some(m) if m.status == MerchantStatus::Suspended => {
                    err!(PhygitalError::MerchantSuspended)
                }
                _ => err!(PhygitalError::MerchantNotVerified),
            };
        }
        policy.charge(&mint, amount, now)?;
        token.accept_assertion(assertion)?;
        drop(token);

        let remaining_today = policy.remaining_today(&mint);
        ctx.accounts.spend_policy.set_inner(policy);

        let accounts = &ctx.accounts;
        transfer_as_delegate(
            &accounts.token_program.to_account_info(),
            &accounts.source.to_account_info(),
            &accounts.mint.to_account_info(),
            &accounts.destination.to_account_info(),
            &accounts.delegate.to_account_info(),
            &owner,
            delegate_bump,
            amount,
            decimals,
        )?;

        let origin = secp256r1_verify_args.origin().unwrap_or_default();
        let origin = &origin[..origin.len().min(MAX_EVENT_ORIGIN_LEN)];
        emit_cpi!(TapPaymentEvent {
            phygital_token: accounts.phygital_token.key(),
            owner,
            merchant: accounts.merchant.key(),
            verified,
            mint,
            source: accounts.source.key(),
            destination: accounts.destination.key(),
            payee,
            amount,
            reference: accounts.reference.key(),
            remaining_today,
            sign_count,
            origin: String::from_utf8_lossy(origin).into_owned(),
        });
        Ok(())
    }
}

/// The merchant's registry entry, or `None` if it is not registered.
fn load_merchant(info: &AccountInfo) -> Result<Option<Merchant>> {
    if *info.owner != crate::ID {
        return Ok(None);
    }
    Ok(Some(Merchant::try_deserialize(
        &mut &info.try_borrow_data()?[..],
    )?))
}
