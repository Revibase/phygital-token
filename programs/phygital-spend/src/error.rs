use anchor_lang::prelude::*;

#[error_code]
pub enum SpendError {
    #[msg("Token owner mismatch")]
    OwnerMismatch,

    #[msg("Token recipient mismatch")]
    RecipientMismatch,

    #[msg("The token account mint does not match the spend mint")]
    SpendMintMismatch,

    #[msg("The asset must be locked to spend its delegated allowance")]
    AssetIsNotLocked,

    #[msg("Spend amount must be greater than zero")]
    SpendAmountZero,

    #[msg("The token account's delegate is not this asset's spend authority")]
    SpendDelegateMismatch,

    #[msg("Spend amount exceeds the delegated allowance")]
    InsufficientSpendAllowance,

    #[msg("Invalid spend recipient")]
    InvalidSpendRecipient,

    #[msg("The phygital-token program account does not match the expected program id")]
    InvalidPhygitalTokenProgram,

    #[msg("The asset account is not a valid phygital-token asset")]
    InvalidAssetAccount,
}
