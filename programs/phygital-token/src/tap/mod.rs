//! Secp256r1 precompile verification for a tap's signed challenge.
//!
//! The accessory signs `b"authorize" || challenge` (41 bytes) with its
//! product P-256 key. The transaction carries that signature in a secp256r1
//! precompile instruction, which the runtime verifies before the program runs.
//! This module then:
//!
//! 1. finds the precompile instruction and reads the verified public key and
//!    message from it ([`secp256r1`]);
//! 2. checks the message equals `authorize || expected_challenge`
//!    (challenge built in [`challenge`]);
//! 3. returns the public key for the caller to compare with the token
//!    ([`crate::state::PhygitalToken::accept_tap`]).

pub mod challenge;
pub mod secp256r1;

use anchor_lang::prelude::*;

use crate::error::PhygitalError;
use crate::sysvar::relative_instruction_parts;
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

/// Prefix the card requires on every message it signs (the FIDO2 applet
/// refuses any other allowList id). It keeps these signatures apart from the
/// card's WebAuthn signatures, whose signed bytes start with an rpId hash.
pub const AUTHORIZE_PREFIX: &[u8] = b"authorize";

/// Length of the domain-tagged challenge payload (without the product prefix).
pub const CHALLENGE_LEN: usize = 32;

/// Length of the bytes the accessory signs: `authorize || challenge`.
pub const SIGNED_MESSAGE_LEN: usize = AUTHORIZE_PREFIX.len() + CHALLENGE_LEN;

/// Instruction argument locating a tap's secp256r1 precompile signature.
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug, Clone)]
pub struct Secp256r1VerifyArgs {
    /// Position of the secp256r1 precompile instruction relative to the
    /// current top-level instruction (usually `-1`: immediately before).
    pub relative_index: i64,
    /// Which signature inside the precompile instruction to use.
    pub signature_index: u8,
}

impl Secp256r1VerifyArgs {
    /// Reads the precompile entry and requires its signed message to equal
    /// `authorize || expected_challenge`. Returns the signing public key.
    /// The caller must still check the key belongs to the token and advance
    /// the slot counter.
    pub fn verify_signed_challenge(
        &self,
        instructions_sysvar: &UncheckedAccount,
        expected_challenge: [u8; CHALLENGE_LEN],
    ) -> Result<Secp256r1Pubkey> {
        let sysvar = instructions_sysvar.try_borrow_data()?;
        let (program_id, data) = relative_instruction_parts(&sysvar, self.relative_index)?;
        require!(
            program_id == SECP256R1_PROGRAM_ID.as_ref(),
            PhygitalError::InvalidSecp256r1Instruction
        );

        let (extracted_pubkey, message) =
            signed_public_key_and_message(data, self.signature_index, SIGNED_MESSAGE_LEN)?;
        require!(
            message.len() == SIGNED_MESSAGE_LEN,
            PhygitalError::ChallengeHashMismatch
        );
        require!(
            message.starts_with(AUTHORIZE_PREFIX),
            PhygitalError::ChallengeHashMismatch
        );
        require!(
            &message[AUTHORIZE_PREFIX.len()..] == expected_challenge.as_slice(),
            PhygitalError::ChallengeHashMismatch
        );

        Ok(Secp256r1Pubkey(extracted_pubkey))
    }
}
