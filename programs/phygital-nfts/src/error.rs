use anchor_lang::prelude::*;

#[error_code]
pub enum PhygitalError {
    #[msg("The instruction preceding this program invocation is not a secp256r1 verification instruction")]
    InvalidSecp256r1Instruction,

    #[msg("The signature index provided is out of bounds for the secp256r1 instruction")]
    SignatureIndexOutOfBounds,

    #[msg("Failed to deserialize secp256r1 signature offsets from the instruction data")]
    InvalidSignatureOffsets,

    #[msg("Invalid secp256r1 public key")]
    InvalidSecp256r1PublicKey,

    #[msg("secp256r1 pubkey does not match token record")]
    Secp256r1PubkeyMismatch,

    #[msg("Mint does not match token record")]
    MintMismatch,

    #[msg("Token owner mismatch")]
    OwnerMismatch,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Tap counter must be greater than the last successful transfer counter — signature is being replayed")]
    StaleTransferCounter,

    #[msg("Signed tap message is not the expected counter || nonce layout")]
    InvalidTapMessage,

    #[msg("Missing instructions sysvar account")]
    MissingInstructionsSysvar,

    #[msg("Max length exceeded")]
    MaxLengthExceeded,

    #[msg("Authority does not match")]
    AuthorityMismatch,

    #[msg("Custody token account must be the canonical ATA for program_authority")]
    InvalidCustodyTokenAccount,
}
