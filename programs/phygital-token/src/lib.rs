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
pub mod rules;
pub mod state;
pub mod wallet;
pub mod webauthn;

pub use constants::*;
pub use instructions::*;
pub use policy::*;
pub use rules::*;
pub use state::*;
pub use wallet::*;
pub use webauthn::*;

use anchor_lang::prelude::*;
declare_id!("phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz");

#[program]
pub mod phygital_token {
    use super::*;

    pub fn create_config(ctx: Context<CreateConfig>) -> Result<()> {
        CreateConfig::handler(ctx)
    }

    pub fn set_admin(ctx: Context<SetRole>, new_admin: Pubkey) -> Result<()> {
        SetRole::set_admin(ctx, new_admin)
    }

    pub fn set_issuer(ctx: Context<SetRole>, issuer: Pubkey) -> Result<()> {
        SetRole::set_issuer(ctx, issuer)
    }

    pub fn set_minter(ctx: Context<SetRole>, minter: Pubkey) -> Result<()> {
        SetRole::set_minter(ctx, minter)
    }

    pub fn close_phygital_token(ctx: Context<ClosePhygitalToken>) -> Result<()> {
        ClosePhygitalToken::handler(ctx)
    }

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        Initialize::handler(ctx, args)
    }

    pub fn assign_mint(ctx: Context<AssignMint>, mint: Pubkey) -> Result<()> {
        AssignMint::handler(ctx, mint)
    }

    pub fn set_owner(
        ctx: Context<SetOwner>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        SetOwner::handler(ctx, secp256r1_verify_args, slot_number)
    }

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

    pub fn remove_owner(ctx: Context<RemoveOwner>) -> Result<()> {
        RemoveOwner::handler(ctx)
    }

    // Optional accessory wallet. Nothing above needs it: authentication is
    // `verify`. The owner can always execute; a tap needs the owner's policy.

    pub fn update_policy(ctx: Context<UpdatePolicy>, actions: Vec<PolicyAction>) -> Result<()> {
        UpdatePolicy::handler(ctx, actions)
    }

    pub fn close_policy(_ctx: Context<ClosePolicy>) -> Result<()> {
        Ok(())
    }

    pub fn execute_with_owner<'info>(
        ctx: Context<'info, ExecuteWithOwner<'info>>,
        compact_instructions: Vec<CompactInstruction>,
    ) -> Result<()> {
        ExecuteWithOwner::handler(ctx, compact_instructions)
    }

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
