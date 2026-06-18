use anchor_lang::prelude::*;

#[error_code]
pub enum TransferHookError {
    #[msg("Transfer authority must be program_authority")]
    InvalidTransferAuthority,
}
