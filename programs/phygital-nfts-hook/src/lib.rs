#![allow(ambiguous_glob_reexports)]

pub mod constants;
pub mod error;
pub mod execute_transfer_hook;

use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub use constants::*;
pub use error::*;
pub use execute_transfer_hook::*;

declare_id!("FCBG7gTThZ9hg4axra4UqWBerBhdjhdBLqxD1jicg84G");

#[program]
pub mod phygital_nfts_hook {
    use super::*;

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn execute_transfer_hook(ctx: Context<ExecuteTransferHook>, amount: u64) -> Result<()> {
        execute_transfer_hook::handler(ctx, amount)
    }
}
