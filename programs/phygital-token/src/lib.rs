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

    pub fn set_lock_state(ctx: Context<SetLockState>, is_locked: bool) -> Result<()> {
        set_lock_state::handler(ctx, is_locked)
    }

    pub fn execute_transfer(
        ctx: Context<ExecuteTransfer>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
    ) -> Result<()> {
        execute_transfer::handler(ctx, secp256r1_verify_args)
    }

    pub fn verify_asset(
        ctx: Context<VerifyAsset>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
        message: Vec<u8>,
        expected_rp_id: Option<String>,
        expected_origin: Option<String>,
    ) -> Result<()> {
        verify_asset::handler(
            ctx,
            secp256r1_verify_args,
            message,
            expected_rp_id,
            expected_origin,
        )
    }

    pub fn remove_ownership(ctx: Context<RemoveOwnership>) -> Result<()> {
        remove_ownership::handler(ctx)
    }
}
