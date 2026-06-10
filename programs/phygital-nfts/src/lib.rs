#![allow(ambiguous_glob_reexports)]

pub mod error;
pub mod instructions;
pub mod utils;

pub use instructions::*;
pub use utils::*;

use anchor_lang::prelude::*;
declare_id!("3qr6jpvHGuJ1tDk49gRtPH8rndTRfa1M7PpqMVmx1un1");

#[program]
pub mod phygital_nfts {
    use super::*;

    pub fn create_group_token(
        ctx: Context<CreateGroupToken>,
        args: CreateGroupTokenArgs,
    ) -> Result<()> {
        create_group_token::handler(ctx, args)
    }

    pub fn create_token(ctx: Context<CreateToken>, args: CreateTokenArgs) -> Result<()> {
        create_token::handler(ctx, args)
    }

    pub fn execute_transfer(
        ctx: Context<ExecuteTransfer>,
        secp256r1_verify_args: Secp256r1VerifyArgs,
    ) -> Result<()> {
        execute_transfer::handler(ctx, secp256r1_verify_args)
    }
}
