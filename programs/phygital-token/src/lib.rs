#![allow(ambiguous_glob_reexports)]

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;
pub use state::*;
pub use utils::*;

use anchor_lang::prelude::*;
declare_id!("DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ");

#[program]
pub mod phygital_token {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        initialize::handler(ctx, args)
    }

    pub fn set_mint(ctx: Context<SetMint>, mint: Pubkey) -> Result<()> {
        set_mint::handler(ctx, mint)
    }

    pub fn transfer_ownership(
        ctx: Context<TransferOwnership>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        transfer_ownership::handler(ctx, secp256r1_verify_args, slot_number)
    }

    /// Prove passkey possession and advance `last_sign_count`.
    ///
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
        verify::handler(
            ctx,
            secp256r1_verify_args,
            message_hash,
            expected_rp_id,
            expected_origins,
        )
    }

    pub fn remove_ownership(ctx: Context<RemoveOwnership>) -> Result<()> {
        remove_ownership::handler(ctx)
    }
}
