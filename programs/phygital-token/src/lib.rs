#![allow(ambiguous_glob_reexports)]

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;
pub use state::*;
pub use utils::*;

use anchor_lang::prelude::*;
declare_id!("DdwhetyqgSB56XVcR33ySG5dFmvwbjSc5aSMHRg5Bk6A");

#[program]
pub mod phygital_token {
    use super::*;

    pub fn create_mint(ctx: Context<CreateMint>, args: CreateMintArgs) -> Result<()> {
        create_mint::handler(ctx, args)
    }

    pub fn mint_token(ctx: Context<MintToken>, args: MintTokenArgs) -> Result<()> {
        mint_token::handler(ctx, args)
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
    ) -> Result<()> {
        verify_asset::handler(ctx, secp256r1_verify_args, message)
    }
}
