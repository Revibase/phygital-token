//! Program errors.
//!
//! Anchor numbers these from 6000 in declaration order, and clients match on the
//! number. Never reorder or remove a variant; add new ones at the end.

use anchor_lang::prelude::*;

#[error_code]
pub enum PhygitalError {
    /// The instruction at `verify_args_relative_index` is missing or is not the secp256r1 precompile.
    #[msg("No prior secp256r1 verification instruction in this transaction matches the provided client data")]
    InvalidSecp256r1Instruction,

    /// `signed_message_index` is not below the precompile's signature count.
    #[msg("The signature index provided is out of bounds for the secp256r1 instruction")]
    SignatureIndexOutOfBounds,

    /// A precompile offsets entry is truncated, points outside the instruction, names another instruction, or its message is too short.
    #[msg("Failed to deserialize secp256r1 signature offsets from the instruction data")]
    InvalidSignatureOffsets,

    /// The public key the offsets point to is out of bounds.
    #[msg("Invalid secp256r1 public key")]
    InvalidSecp256r1PublicKey,

    /// The assertion was signed by a key other than the token's passkey.
    #[msg("secp256r1 pubkey does not match phygital token record")]
    Secp256r1PubkeyMismatch,

    /// The signer is not the token's owner.
    #[msg("Phygital token owner mismatch")]
    OwnerMismatch,

    /// `slot_number` is not in the SlotHashes sysvar (too old, or never existed).
    #[msg("Slot not found in SlotHashes sysvar — signature has expired or is being replayed")]
    InvalidSlotHash,

    /// The authenticator's sign count did not increase: a replayed or cloned assertion.
    #[msg("WebAuthn signCount must be greater than the last accepted signCount")]
    StaleSignCount,

    /// The signed message does not end with `SHA256(client_data_json)`.
    #[msg("Client data hash mismatch")]
    ClientDataHashMismatch,

    /// A sysvar's data does not have the expected layout.
    #[msg("Invalid sysvar data format")]
    InvalidSysvarDataFormat,

    /// `set_owner` on a Controlled or Permanent token that has an owner.
    #[msg("The owner needs to unlock the phygital token to enable transfer.")]
    TokenIsCurrentlyLocked,

    /// A required `clientDataJSON` field is missing or malformed.
    #[msg("Unable to parse client data JSON.")]
    UnableToParseClientData,

    /// `clientDataJSON.challenge` is not the challenge this instruction expects.
    #[msg("Challenge hash mismatch.")]
    ChallengeHashMismatch,

    /// The authenticator data is too short.
    #[msg("Authenticator data is too short to contain WebAuthn flags.")]
    InvalidAuthenticatorData,

    /// The authenticator did not set the user-present flag.
    #[msg("WebAuthn user presence flag (UP) was not set by the authenticator.")]
    UserPresenceNotVerified,

    /// No longer raised: only the removed `verify` instruction checked the rpId.
    /// Kept so the codes after it keep their numbers.
    #[msg("WebAuthn rpId hash does not match the expected relying party id.")]
    RpIdMismatch,

    /// `clientDataJSON.origin` is not allowed.
    #[msg("WebAuthn origin does not match any expected origin.")]
    OriginMismatch,

    /// The signer is not the issuer or minter, or a role key is the default key.
    #[msg("Only the designated authority can perform this action.")]
    UnauthorizedAuthority,

    /// The signer is not the admin.
    #[msg("Only the admin can perform this action.")]
    UnauthorizedAdmin,

    /// The new role key already holds a role.
    #[msg("Key already exists on the admin config.")]
    KeyAlreadyExists,

    /// `initialize` gave a Permanent token no owner, or another type an owner.
    /// A tapped execute on a token without an owner.
    #[msg("Only Permanent phygital tokens set an owner at initialize, and they must set one.")]
    PermanentOwnerRequired,

    /// `remove_owner` on a Permanent token.
    #[msg("Permanent phygital token owner cannot be transferred or removed.")]
    PermanentOwnerImmutable,

    #[msg("The token has no owner.")]
    OwnerRequired,

    /// A compact instruction references a remaining account that does not exist.
    #[msg("Compact instruction account index out of bounds.")]
    InvalidAccountIndex,

    /// An inner instruction calls this program.
    #[msg("Compact instructions may not call the phygital-token program.")]
    SelfReentrancyNotAllowed,

    /// An execute instruction was invoked through CPI.
    #[msg("Execute must be a top-level instruction.")]
    ExecuteViaCpiNotAllowed,

    /// An execute instruction in a durable-nonce transaction.
    #[msg("Durable-nonce transactions are not allowed.")]
    DurableNonceNotAllowed,

    /// Inner instructions changed the wallet's owner program or data length.
    #[msg("Wallet PDA owner or data length changed during inner CPI.")]
    WalletInvariantViolated,

    /// The token or policy account was passed to an inner instruction as signer or writable.
    #[msg("Protected account may not be a signer or writable in inner instructions.")]
    ProtectedAccountPrivilege,

    /// A policy edit is invalid (see `policy::actions` and `policy::permissions`).
    #[msg("Policy arguments are invalid.")]
    InvalidPolicyArgs,

    /// The policy does not list the inner instruction's program.
    #[msg("Program is not allowed: the policy lists every program the accessory may call.")]
    ProgramNotAllowed,

    /// The program is listed, but no rule matches the inner instruction.
    #[msg("Instruction does not satisfy the configured program rules.")]
    InstructionNotAllowed,

    /// SOL or a token left the wallet with no cap covering it.
    #[msg("No spend cap covers this SOL or token transfer.")]
    SpendNotAllowed,

    /// The spend exceeds what remains of the cap in this window.
    #[msg("Transfer exceeds the configured spending limit.")]
    SpendLimitExceeded,

    /// The spend exceeds the cap's per-execute limit.
    #[msg("Transfer exceeds the configured max per transaction.")]
    MaxPerTxExceeded,

    /// A wallet-owned token account has a delegate after the execute.
    #[msg("Execute may not leave a standing delegate on a wallet-owned token account.")]
    DelegationNotAllowed,

    /// A wallet-owned token account changed owner, mint or close authority, or was closed with lamports left.
    #[msg("Wallet-owned token account control changed during execute.")]
    TokenAuthorityChanged,

    /// Returned by every successful `preview_execute`; it never lands.
    #[msg("Preview passed: an accessory tap would be allowed (preview_execute never lands).")]
    PreviewPassed,

    /// `clientDataJSON.type` is not `webauthn.get`.
    #[msg("clientDataJSON type must be webauthn.get.")]
    ClientDataTypeMismatch,
}
