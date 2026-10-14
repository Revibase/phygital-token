//! Preconditions for a tap payment.
//!
//! - Top level only: keeps the precompile's relative index unambiguous and the
//!   payment out of other programs' control flow. The challenge already binds
//!   everything that matters, so this is a simplicity choice, not a fix.
//! - No durable nonce: the challenge's slot hash already bounds how long a tap
//!   stays valid; this keeps a nonce transaction (whose first instruction is the
//!   system program's `AdvanceNonceAccount`) from suggesting otherwise.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};

use crate::error::PhygitalError;
use crate::sysvar::instruction_parts;

pub(crate) fn require_direct_tx(instructions_sysvar: &AccountInfo) -> Result<()> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        PhygitalError::ExecuteViaCpiNotAllowed
    );
    let sysvar = instructions_sysvar.try_borrow_data()?;
    let (program_id, data) = instruction_parts(&sysvar, 0)?;
    const ADVANCE_NONCE: [u8; 4] = 4u32.to_le_bytes();
    require!(
        program_id != system_program::ID.as_ref() || !data.starts_with(&ADVANCE_NONCE),
        PhygitalError::DurableNonceNotAllowed
    );
    Ok(())
}
