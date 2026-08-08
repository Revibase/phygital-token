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

    #[msg("secp256r1 pubkey does not match token record")]
    Secp256r1PubkeyMismatch,

    #[msg("Token owner mismatch")]
    OwnerMismatch,

    #[msg("Slot not found in SlotHashes sysvar — signature has expired or is being replayed")]
    InvalidSlotHash,

    #[msg("WebAuthn signCount must be greater than the last accepted signCount")]
    StaleSignCount,

    #[msg("Client data hash mismatch")]
    ClientDataHashMismatch,

    #[msg("Missing instructions sysvar account")]
    MissingInstructionsSysvar,

    #[msg("Invalid sysvar data format")]
    InvalidSysvarDataFormat,

    #[msg("Recipient cannot be the default (zero) pubkey")]
    InvalidRecipient,

    #[msg("The owner needs to unlock the asset to enable transfer.")]
    AssetIsCurrentlyLocked,

    #[msg("This asset is not lockable.")]
    AssetIsNotLockable,

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

    #[msg("WebAuthn origin does not match the expected origin.")]
    OriginMismatch,
}
