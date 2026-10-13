//! WebAuthn assertion verification against a secp256r1 precompile instruction.
//!
//! A tap produces a WebAuthn assertion: the authenticator signs
//! `authenticatorData || SHA256(clientDataJSON)` with its P-256 key. The
//! transaction carries that signature in a secp256r1 precompile instruction,
//! which the runtime verifies before the program runs, and the
//! `clientDataJSON` in the instruction arguments. This program then:
//!
//! 1. checks `clientDataJSON.type` is `webauthn.get` and its `challenge` is the
//!    one the instruction expects (built in [`challenge`]);
//! 2. optionally checks `clientDataJSON.origin`;
//! 3. finds the precompile instruction and reads the verified public key and
//!    message from it ([`secp256r1`]);
//! 4. checks the user-present flag and that the message ends with
//!    `SHA256(clientDataJSON)`;
//! 5. returns the public key and sign count for the caller to compare with the
//!    token ([`crate::state::PhygitalToken::accept_assertion`]).

pub mod challenge;
mod client_data;
pub mod secp256r1;

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::error::PhygitalError;
use crate::sysvar::relative_instruction_parts;
use client_data::{
    extract_challenge_from_client_data_json, json_quoted_value, JSON_ORIGIN_KEY, JSON_TYPE_KEY,
};
use secp256r1::{
    signed_public_key_and_message, COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID,
};

#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Eq, PartialEq, Hash, Debug, Clone, Copy,
)]
#[repr(transparent)]
pub struct Secp256r1Pubkey(pub [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE]);

impl Default for Secp256r1Pubkey {
    fn default() -> Self {
        Secp256r1Pubkey([0u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE])
    }
}

impl AsRef<[u8]> for Secp256r1Pubkey {
    fn as_ref(&self) -> &[u8] {
        self.0.as_ref()
    }
}

/// PDA seed for a token: the key's x coordinate, without the parity prefix
/// (32 bytes, the maximum seed length).
pub fn secp256r1_pda_seed(pubkey: &Secp256r1Pubkey) -> &[u8] {
    &pubkey.0[1..]
}

/// Minimum WebAuthn authenticator data: rpIdHash (32) + flags (1) + signCount (4).
pub const AUTH_DATA_MIN_LEN: usize = 37;
const AUTH_DATA_FLAGS_OFFSET: usize = 32;
const AUTH_DATA_SIGN_COUNT_OFFSET: usize = 33;
const CLIENT_DATA_HASH_LEN: usize = 32;
const FLAG_USER_PRESENT: u8 = 0x01;
const MIN_SIGNED_MESSAGE_LEN: usize = AUTH_DATA_MIN_LEN + CLIENT_DATA_HASH_LEN;

/// Whether a `clientDataJSON.origin` is allowed.
pub type OriginCheck<'a> = &'a dyn Fn(&[u8]) -> Result<bool>;

/// Instruction argument locating and completing a tap's assertion.
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug, Clone)]
pub struct Secp256r1VerifyArgs {
    /// Position of the secp256r1 precompile instruction relative to the
    /// current top-level instruction (usually `-1`: immediately before).
    pub verify_args_relative_index: i64,
    /// Which signature inside the precompile instruction to use.
    pub signed_message_index: u8,
    /// The exact bytes whose SHA-256 the authenticator signed.
    pub client_data_json: Vec<u8>,
}

impl Secp256r1VerifyArgs {
    /// Verifies the assertion against `expected_challenge` and returns the
    /// signing public key and the authenticator's sign count. The caller must
    /// still check the key belongs to the token and the count has advanced.
    ///
    /// The origin check is skipped when `origin_allowed` is `None`. The rpId
    /// is not checked: a credential's key is scoped to one rpId on standard
    /// authenticators, and the challenge binds the action.
    pub fn verify_webauthn_assertion(
        &self,
        instructions_sysvar: &UncheckedAccount,
        expected_challenge: [u8; 32],
        origin_allowed: Option<OriginCheck>,
    ) -> Result<(Secp256r1Pubkey, u32)> {
        require!(
            json_quoted_value(&self.client_data_json, JSON_TYPE_KEY)? == b"webauthn.get",
            PhygitalError::ClientDataTypeMismatch
        );
        let extracted_challenge = extract_challenge_from_client_data_json(&self.client_data_json)?;
        require!(
            extracted_challenge == expected_challenge,
            PhygitalError::ChallengeHashMismatch
        );

        if let Some(origin_allowed) = origin_allowed {
            let origin = json_quoted_value(&self.client_data_json, JSON_ORIGIN_KEY)?;
            require!(origin_allowed(origin)?, PhygitalError::OriginMismatch);
        }

        let sysvar = instructions_sysvar.try_borrow_data()?;
        let (program_id, data) =
            relative_instruction_parts(&sysvar, self.verify_args_relative_index)?;
        require!(
            program_id == SECP256R1_PROGRAM_ID.as_ref(),
            PhygitalError::InvalidSecp256r1Instruction
        );

        let (extracted_pubkey, message) =
            signed_public_key_and_message(data, self.signed_message_index, MIN_SIGNED_MESSAGE_LEN)?;
        // Already guaranteed by MIN_SIGNED_MESSAGE_LEN; kept so the slicing
        // below is visibly in bounds.
        require!(
            message.len() >= AUTH_DATA_MIN_LEN,
            PhygitalError::InvalidAuthenticatorData
        );

        let flags = *message
            .get(AUTH_DATA_FLAGS_OFFSET)
            .ok_or(PhygitalError::InvalidAuthenticatorData)?;
        require!(
            flags & FLAG_USER_PRESENT != 0,
            PhygitalError::UserPresenceNotVerified
        );

        let sign_count_bytes: [u8; 4] = message
            [AUTH_DATA_SIGN_COUNT_OFFSET..AUTH_DATA_SIGN_COUNT_OFFSET + 4]
            .try_into()
            .map_err(|_| PhygitalError::InvalidAuthenticatorData)?;
        let sign_count = u32::from_be_bytes(sign_count_bytes);

        let client_data_hash: [u8; 32] = message[(message.len() - CLIENT_DATA_HASH_LEN)..]
            .try_into()
            .map_err(|_| PhygitalError::InvalidSignatureOffsets)?;
        require!(
            client_data_hash == hash(&self.client_data_json).to_bytes(),
            PhygitalError::ClientDataHashMismatch
        );

        Ok((Secp256r1Pubkey(extracted_pubkey), sign_count))
    }
}
