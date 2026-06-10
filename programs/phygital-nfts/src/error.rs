use anchor_lang::prelude::*;

#[error_code]
pub enum TokenProgramError {
    #[msg("Invalid secp256r1 signature")]
    InvalidSecp256r1Signature,

    #[msg("Malformed or missing WebAuthn verification parameters")]
    InvalidSecp256r1VerifyArg,

    #[msg("The instruction preceding this program invocation is not a secp256r1 verification instruction")]
    InvalidSecp256r1Instruction,

    #[msg("secp256r1 instruction missing from transaction")]
    MissingSecp256r1Instruction,

    #[msg("The signature index provided is out of bounds for the secp256r1 instruction")]
    SignatureIndexOutOfBounds,

    #[msg("Failed to deserialize secp256r1 signature offsets from the instruction data")]
    InvalidSignatureOffsets,

    #[msg("Invalid secp256r1 public key")]
    InvalidSecp256r1PublicKey,

    #[msg("secp256r1 pubkey does not match token record")]
    Secp256r1PubkeyMismatch,

    #[msg("Transfer price not met")]
    InsufficientTransferPayment,

    #[msg("Recipient is not the allowed recipient set in transfer config")]
    RecipientNotAllowed,

    #[msg("Royalty basis points cannot exceed 10000")]
    InvalidRoyaltyBps,

    #[msg("Mint metadata is missing or invalid")]
    InvalidMetadata,

    #[msg("Group mint does not match token record")]
    GroupMintMismatch,

    #[msg("Token owner mismatch")]
    OwnerMismatch,

    #[msg("Payment token mint mismatch")]
    PaymentTokenMintMismatch,

    #[msg("Payment token mint must be set when transfer price is greater than zero")]
    PaymentTokenMintRequired,

    #[msg("Payment token program must be set when payment token mint is set")]
    PaymentTokenProgramRequired,

    #[msg("Payment token program mismatch")]
    PaymentTokenProgramMismatch,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid transfer hook program ID")]
    InvalidTransferHookProgram,

    #[msg("Slot not found in SlotHashes sysvar — signature has expired or is being replayed")]
    InvalidSlotHash,

    #[msg("Transfer slot must be greater than the last successful transfer slot")]
    StaleTransferSlot,

    #[msg("Transfer authority must be the program permanent delegate")]
    InvalidTransferAuthority,

    #[msg("Sender token account close authority must be delegated to the program")]
    InvalidCloseAuthority,

    #[msg("RpId hash mismatch")]
    RpIdHashMismatch,

    #[msg("Origin index out of bounds")]
    OriginIndexOutOfBounds,

    #[msg("Client data hash mismatch")]
    ClientDataHashMismatch,

    #[msg("Missing instructions sysvar account")]
    MissingInstructionsSysvar,

    #[msg("Invalid sysvar data format")]
    InvalidSysvarDataFormat,

    #[msg("Max length exceeded")]
    MaxLengthExceeded,

    #[msg("Domain config account is missing")]
    DomainConfigIsMissing,

    #[msg("Domain config account does not match collection metadata")]
    DomainConfigKeyMismatch,

    #[msg("Authority does not match")]
    AuthorityMismatch,

    #[msg("Payment token account must be the canonical ATA for the expected owner")]
    InvalidPaymentTokenAccount,
}
