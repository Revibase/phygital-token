use anchor_lang::prelude::*;

#[error_code]
pub enum PhygitalError {
    #[msg("No prior secp256r1 verification instruction in this transaction matches the provided client data")]
    InvalidSecp256r1Instruction,

    #[msg("The signature index provided is out of bounds for the secp256r1 instruction")]
    SignatureIndexOutOfBounds,

    #[msg("Failed to deserialize secp256r1 signature offsets from the instruction data")]
    InvalidSignatureOffsets,

    #[msg("Invalid secp256r1 public key")]
    InvalidSecp256r1PublicKey,

    #[msg("secp256r1 pubkey does not match phygital token record")]
    Secp256r1PubkeyMismatch,

    #[msg("Phygital token owner mismatch")]
    OwnerMismatch,

    #[msg("Slot not found in SlotHashes sysvar — signature has expired or is being replayed")]
    InvalidSlotHash,

    #[msg("WebAuthn signCount must be greater than the last accepted signCount")]
    StaleSignCount,

    #[msg("Client data hash mismatch")]
    ClientDataHashMismatch,


    #[msg("Invalid sysvar data format")]
    InvalidSysvarDataFormat,

    #[msg("The owner needs to unlock the phygital token to enable transfer.")]
    TokenIsCurrentlyLocked,


    #[msg("Unable to parse client data JSON.")]
    UnableToParseClientData,

    #[msg("Challenge hash mismatch.")]
    ChallengeHashMismatch,

    #[msg("Authenticator data is too short to contain WebAuthn flags.")]
    InvalidAuthenticatorData,

    #[msg("WebAuthn user presence flag (UP) was not set by the authenticator.")]
    UserPresenceNotVerified,

    #[msg("WebAuthn rpId hash does not match the expected relying party id.")]
    RpIdMismatch,

    #[msg("WebAuthn origin does not match any expected origin.")]
    OriginMismatch,

    #[msg("Only the designated authority can perform this action.")]
    UnauthorizedAuthority,

    #[msg("Only the admin can perform this action.")]
    UnauthorizedAdmin,

    #[msg("Key already exists on the admin config.")]
    KeyAlreadyExists,

    #[msg("Only Permanent phygital tokens set an owner at initialize, and they must set one.")]
    PermanentOwnerRequired,

    #[msg("Permanent phygital token owner cannot be transferred or removed.")]
    PermanentOwnerImmutable,

    #[msg("The token has no owner.")]
    OwnerRequired,

    #[msg("Compact instruction account index out of bounds.")]
    InvalidAccountIndex,

    #[msg("Compact instructions may not call the phygital-token program.")]
    SelfReentrancyNotAllowed,

    #[msg("Execute must be a top-level instruction.")]
    ExecuteViaCpiNotAllowed,

    #[msg("Durable-nonce transactions are not allowed.")]
    DurableNonceNotAllowed,

    #[msg("Wallet PDA owner or data length changed during inner CPI.")]
    WalletInvariantViolated,

    #[msg("Protected account may not be a signer or writable in inner instructions.")]
    ProtectedAccountPrivilege,

    #[msg("Policy arguments are invalid.")]
    InvalidPolicyArgs,

    #[msg("Program is not allowed: the policy lists every program the accessory may call.")]
    ProgramNotAllowed,

    #[msg("Instruction does not satisfy the configured program rules.")]
    InstructionNotAllowed,

    #[msg("No spend cap covers this SOL or token transfer.")]
    SpendNotAllowed,

    #[msg("Transfer exceeds the configured spending limit.")]
    SpendLimitExceeded,

    #[msg("Transfer exceeds the configured max per transaction.")]
    MaxPerTxExceeded,

    #[msg("Execute may not leave a standing delegate on a wallet-owned token account.")]
    DelegationNotAllowed,

    #[msg("Wallet-owned token account control changed during execute.")]
    TokenAuthorityChanged,

    #[msg("Preview passed: an accessory tap would be allowed (preview_execute never lands).")]
    PreviewPassed,

    #[msg("clientDataJSON type must be webauthn.get.")]
    ClientDataTypeMismatch,
}
