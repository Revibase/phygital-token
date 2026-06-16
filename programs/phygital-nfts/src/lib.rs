#![allow(ambiguous_glob_reexports)]

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;
pub use state::*;
pub use utils::*;

use anchor_lang::prelude::*;
declare_id!("3qr6jpvHGuJ1tDk49gRtPH8rndTRfa1M7PpqMVmx1un1");

#[program]
pub mod phygital_nfts {
    use super::*;

    pub fn create_mint(
        ctx: Context<CreateMint>,
        args: CreateMintArgs,
    ) -> Result<()> {
        create_mint::handler(ctx, args)
    }

    pub fn mint_token(ctx: Context<MintToken>, args: MintTokenArgs) -> Result<()> {
        mint_token::handler(ctx, args)
    }

    pub fn execute_transfer(
        ctx: Context<ExecuteTransfer>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
    ) -> Result<()> {
        execute_transfer::handler(ctx, secp256r1_verify_args)
    }
}
