//! # phygital-token
//!
//! A Solana program that binds a physical accessory (an NFC chip holding a
//! P-256 passkey) to an on-chain token, so that a live tap can be verified
//! on-chain.
//!
//! - **Authenticate** (`verify`): prove a tap over a caller-chosen message. Needs
//!   no owner, wallet, policy or SOL.
//! - **Own** (`set_owner`, `remove_owner`): a tap assigns the token to a wallet
//!   key; Controlled and Permanent tokens stay locked while owned.
//! - **Optional wallet** (`execute_with_owner`, `update_policy`,
//!   `execute_with_accessory`): each token has a wallet PDA. The owner can sign
//!   as it freely; a tap can sign as it only within a policy the owner set.
//!
//! ## Where to start reading
//!
//! | Module | Responsibility |
//! |--------|----------------|
//! | [`instructions`] | One file per instruction: account constraints and handler. |
//! | [`webauthn`] | Verifying a tap's WebAuthn assertion; the signed challenges. |
//! | [`wallet`] | Signing inner instructions as the wallet PDA; spend accounting. |
//! | [`policy`] | Editing, validating and matching the owner's policy. |
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
pub mod policy;
pub mod state;
pub(crate) mod sysvar;
pub mod wallet;
pub mod webauthn;

// Anchor's `#[program]` macro resolves each instruction's `Accounts` type and
// generated client modules through this glob.
pub use instructions::*;

pub use constants::*;
pub use error::PhygitalError;
pub use policy::{
    AccountConstraint, AccountKeyConstraint, CapArg, Comparison, DataConstraint, DataPredicate,
    InstructionRule, NumericWidth, PolicyAction, ProgramAccess, ProgramPermission,
};
pub use state::{
    AccessoryPolicy, AdminConfig, MintCap, PhygitalToken, PhygitalTokenType, SpendCap,
};
pub use wallet::CompactInstruction;
pub use webauthn::challenge::{build_execute_challenge, build_set_owner_challenge};
pub use webauthn::secp256r1::{
    COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID, SIGNATURE_OFFSETS_SERIALIZED_SIZE,
    SIGNATURE_OFFSETS_START,
};
pub use webauthn::{
    secp256r1_pda_seed, OriginCheck, Secp256r1Pubkey, Secp256r1VerifyArgs, AUTH_DATA_MIN_LEN,
};

use anchor_lang::prelude::*;
declare_id!("phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz");

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

    /// Admin: deletes a token and its policy. The wallet PDA and its assets
    /// remain and return if the same passkey is initialized again.
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

    /// Tap: proves the accessory signed `message_hash` and records its sign count.
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

    /// Owner: gives up the token (not Permanent ones) and closes its policy.
    pub fn remove_owner(ctx: Context<RemoveOwner>) -> Result<()> {
        RemoveOwner::handler(ctx)
    }

    // Optional accessory wallet. Nothing above needs it: authentication is
    // `verify`. The owner can always execute; a tap needs the owner's policy.

    /// Owner: creates or edits the policy that lets a tap use the wallet.
    pub fn update_policy(ctx: Context<UpdatePolicy>, actions: Vec<PolicyAction>) -> Result<()> {
        UpdatePolicy::handler(ctx, actions)
    }

    /// Owner: deletes the policy, blocking taps from using the wallet.
    pub fn close_policy(_ctx: Context<ClosePolicy>) -> Result<()> {
        Ok(())
    }

    /// Owner: runs instructions as the wallet PDA.
    pub fn execute_with_owner<'info>(
        ctx: Context<'info, ExecuteWithOwner<'info>>,
        compact_instructions: Vec<CompactInstruction>,
    ) -> Result<()> {
        ExecuteWithOwner::handler(ctx, compact_instructions)
    }

    /// Tap: runs instructions as the wallet PDA, within the owner's policy.
    pub fn execute_with_accessory<'info>(
        ctx: Context<'info, ExecuteWithAccessory<'info>>,
        compact_instructions: Vec<CompactInstruction>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        ExecuteWithAccessory::handler(
            ctx,
            compact_instructions,
            secp256r1_verify_args,
            slot_number,
        )
    }

    /// Simulation only: always fails, with `PreviewPassed` when a tap would pass.
    pub fn preview_execute<'info>(
        ctx: Context<'info, PreviewExecute<'info>>,
        compact_instructions: Vec<CompactInstruction>,
        origin: Option<String>,
    ) -> Result<()> {
        PreviewExecute::handler(ctx, compact_instructions, origin)
    }
}
