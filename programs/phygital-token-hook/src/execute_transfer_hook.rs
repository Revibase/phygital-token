use anchor_lang::prelude::*;

use crate::constants::{PHYGITAL_TOKEN_PROGRAM_ID, PROGRAM_AUTHORITY_SEED};
use crate::error::TransferHookError;

/// Token-2022 transfer-hook `Execute` passes exactly these four accounts.
#[derive(Accounts)]
pub struct ExecuteTransferHook<'info> {
    /// CHECK: validated by Token-2022 before the hook CPI
    pub source_token_account: UncheckedAccount<'info>,

    /// CHECK: validated by Token-2022 before the hook CPI
    pub mint: UncheckedAccount<'info>,

    /// CHECK: validated by Token-2022 before the hook CPI
    pub destination_token_account: UncheckedAccount<'info>,

    /// CHECK: must be program_authority — only this PDA may act as transfer authority
    pub authority: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ExecuteTransferHook>, _amount: u64) -> Result<()> {
    let (expected_authority, _) =
        Pubkey::find_program_address(&[PROGRAM_AUTHORITY_SEED], &PHYGITAL_TOKEN_PROGRAM_ID);
    require!(
        ctx.accounts.authority.key() == expected_authority,
        TransferHookError::InvalidTransferAuthority,
    );

    msg!(
        "Hook: mint {} transferred via program_authority",
        ctx.accounts.mint.key(),
    );

    Ok(())
}
