//! # phygital-token
//!
//! A Solana program that binds a physical accessory (an NFC chip holding a
//! P-256 passkey) to an on-chain token, so that a live tap can be verified
//! on-chain.
//!
//! - **Authenticate** (`verify`): prove a tap over a caller-chosen message, or
//!   through CPI from another program. Needs no owner.
//! - **Own** (`set_owner`, `remove_owner`): a tap assigns the token to a wallet
//!   key; Controlled and Permanent tokens stay locked while owned.
//! - **Pay** (`update_spend_policy`, `pay_with_accessory`): the owner delegates
//!   SPL tokens to their delegate PDA and sets the accessory's daily limits; one
//!   tap then pays a verified merchant (or a payee the owner allowed), co-signed
//!   by the merchant. A change of owner closes the limits.
//! - **Merchants** (`set_registrar`, `register_merchant`, ...): the registrar
//!   records which keys belong to which verified merchants and wallets.
//!
//! ## Where to start reading
//!
//! | Module | Responsibility |
//! |--------|----------------|
//! | [`instructions`] | One file per instruction: account constraints and handler. |
//! | [`webauthn`] | Verifying a tap's WebAuthn assertion; the signed challenges. |
//! | [`spend`] | Spend-policy edits, daily limits and the delegated transfer. |
//! | [`state`] | Account layouts. |
//! | [`sysvar`] | In-place readers for the Instructions and SlotHashes sysvars. |
//!
//! Invariants and the threat model are in `docs/program/`.

// On-chain code must not panic: every failure is a typed `PhygitalError`.
// Unit tests are exempted in clippy.toml; integration tests are separate crates.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::todo,
    clippy::unimplemented,
    clippy::dbg_macro,
    clippy::undocumented_unsafe_blocks
)]
// Anchor's `#[program]` expansion contains diverging sub-expressions.
#![allow(clippy::diverging_sub_expression)]

pub mod constants;
pub mod error;
pub mod instructions;
pub mod spend;
pub mod state;
pub(crate) mod sysvar;
pub mod webauthn;

// Anchor's `#[program]` macro resolves each instruction's `Accounts` type and
// generated client modules through this glob.
pub use instructions::*;

pub use constants::*;
pub use error::PhygitalError;
pub use spend::SpendPolicyAction;
pub use state::{
    AdminConfig, AllowedPayee, DailyLimit, Merchant, MerchantArgs, MerchantStatus, PhygitalToken,
    PhygitalTokenType, RegistrarConfig, SpendPolicy,
};
pub use webauthn::challenge::{
    build_pay_challenge, build_set_owner_challenge, build_verify_challenge,
};
pub use webauthn::secp256r1::{
    COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID, SIGNATURE_OFFSETS_SERIALIZED_SIZE,
    SIGNATURE_OFFSETS_START,
};
pub use webauthn::{secp256r1_pda_seed, Secp256r1Pubkey, Secp256r1VerifyArgs, AUTH_DATA_MIN_LEN};

use anchor_lang::prelude::*;
declare_id!("phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz");

// Embedded in the program binary so anyone holding only the program id can
// find how to report a vulnerability (`solana-verify`/explorers display it).
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "phygital-token",
    project_url: "https://github.com/Revibase/phygital-token",
    contacts: "link:https://github.com/Revibase/phygital-token/security/advisories/new",
    policy: "https://github.com/Revibase/phygital-token/blob/master/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/Revibase/phygital-token"
}

#[program]
pub mod phygital_token {
    use super::*;

    /// Creates the role registry and makes the signer its admin. Once only.
    pub fn create_config(ctx: Context<CreateConfig>) -> Result<()> {
        CreateConfig::handler(ctx)
    }

    /// Admin: replaces the admin key.
    pub fn set_admin(ctx: Context<SetRole>, new_admin: Pubkey) -> Result<()> {
        SetRole::set_admin(ctx, new_admin)
    }

    /// Admin: sets the key allowed to `initialize` tokens.
    pub fn set_issuer(ctx: Context<SetRole>, issuer: Pubkey) -> Result<()> {
        SetRole::set_issuer(ctx, issuer)
    }

    /// Admin: sets the key allowed to `assign_mint`.
    pub fn set_minter(ctx: Context<SetRole>, minter: Pubkey) -> Result<()> {
        SetRole::set_minter(ctx, minter)
    }

    /// Admin: deletes a token.
    pub fn close_phygital_token(ctx: Context<ClosePhygitalToken>) -> Result<()> {
        ClosePhygitalToken::handler(ctx)
    }

    /// Issuer: registers an accessory's passkey as a new token.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        Initialize::handler(ctx, args)
    }

    /// Minter: records the mint that represents the token.
    pub fn assign_mint(ctx: Context<AssignMint>, mint: Pubkey) -> Result<()> {
        AssignMint::handler(ctx, mint)
    }

    /// Tap: makes the signing `recipient` the owner, unless the token is locked.
    pub fn set_owner(
        ctx: Context<SetOwner>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        SetOwner::handler(ctx, secp256r1_verify_args, slot_number)
    }

    /// Tap: proves the accessory signed `message_hash` (under the `verify`
    /// domain tag) and records its sign count.
    /// `expected_rp_id` / `expected_origins` are optional WebAuthn bindings.
    /// `None` skips the check. When `expected_origins` is `Some`, the signed
    /// origin must match one listed origin.
    pub fn verify(
        ctx: Context<Verify>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        message_hash: [u8; 32],
        expected_rp_id: Option<String>,
        expected_origins: Option<Vec<String>>,
    ) -> Result<()> {
        Verify::handler(
            ctx,
            secp256r1_verify_args,
            message_hash,
            expected_rp_id,
            expected_origins,
        )
    }

    /// Owner: gives up the token (not Permanent ones) and closes its spend policy.
    pub fn remove_owner(ctx: Context<RemoveOwner>) -> Result<()> {
        RemoveOwner::handler(ctx)
    }

    // Tap payments.

    /// Owner: creates or edits the accessory's daily limits and allowed payees.
    pub fn update_spend_policy(
        ctx: Context<UpdateSpendPolicy>,
        actions: Vec<SpendPolicyAction>,
    ) -> Result<()> {
        UpdateSpendPolicy::handler(ctx, actions)
    }

    /// Owner: turns tap payments off for the accessory and takes back the rent.
    pub fn close_spend_policy(_ctx: Context<CloseSpendPolicy>) -> Result<()> {
        Ok(())
    }

    /// Tap, co-signed by the merchant: pays from the owner's delegated token
    /// account within the accessory's daily limit.
    pub fn pay_with_accessory(
        ctx: Context<PayWithAccessory>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
        amount: u64,
        decimals: u8,
    ) -> Result<()> {
        PayWithAccessory::handler(ctx, secp256r1_verify_args, slot_number, amount, decimals)
    }

    // Merchant registry.

    /// Admin: sets the merchant registrar.
    pub fn set_registrar(ctx: Context<SetRegistrar>, registrar: Pubkey) -> Result<()> {
        SetRegistrar::handler(ctx, registrar)
    }

    /// Registrar, with the merchant's consent: records a verified merchant.
    pub fn register_merchant(ctx: Context<RegisterMerchant>, args: MerchantArgs) -> Result<()> {
        RegisterMerchant::handler(ctx, args)
    }

    /// Registrar: changes a merchant's payees, domain and name.
    pub fn update_merchant(ctx: Context<UpdateMerchant>, args: MerchantArgs) -> Result<()> {
        UpdateMerchant::update(ctx, args)
    }

    /// Registrar: suspends or reinstates a merchant.
    pub fn set_merchant_status(ctx: Context<UpdateMerchant>, status: MerchantStatus) -> Result<()> {
        UpdateMerchant::set_status(ctx, status)
    }

    /// Registrar: removes a merchant; the rent goes to the merchant key.
    pub fn close_merchant(ctx: Context<CloseMerchant>) -> Result<()> {
        CloseMerchant::handler(ctx)
    }
}
