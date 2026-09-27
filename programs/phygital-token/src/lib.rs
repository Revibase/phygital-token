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

    pub fn create_config(ctx: Context<CreateConfig>) -> Result<()> {
        create_config::handler(ctx)
    }

    pub fn set_admin(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
        set_admin::handler(ctx, new_admin)
    }

    pub fn set_issuer(ctx: Context<SetIssuer>, issuer: Pubkey) -> Result<()> {
        set_issuer::handler(ctx, issuer)
    }

    pub fn set_minter(ctx: Context<SetMinter>, minter: Pubkey) -> Result<()> {
        set_minter::handler(ctx, minter)
    }

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        initialize::handler(ctx, args)
    }

    pub fn assign_mint(ctx: Context<AssignMint>, mint: Pubkey) -> Result<()> {
        assign_mint::handler(ctx, mint)
    }

    pub fn set_linked_wallet(
        ctx: Context<SetLinkedWallet>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        slot_number: u64,
    ) -> Result<()> {
        set_linked_wallet::handler(ctx, secp256r1_verify_args, slot_number)
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

    pub fn remove_linked_wallet(ctx: Context<RemoveLinkedWallet>) -> Result<()> {
        remove_linked_wallet::handler(ctx)
    }
}
