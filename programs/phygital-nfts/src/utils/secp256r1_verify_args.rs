use anchor_lang::prelude::*;
use solana_instructions_sysvar::load_instruction_at_checked;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::{
    error::PhygitalError,
    utils::secp256r1_pubkey::{
        Secp256r1Pubkey, COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID,
        SIGNATURE_OFFSETS_SERIALIZED_SIZE, SIGNATURE_OFFSETS_START,
    },
};

// `#[repr(C)]` pins field order to match the secp256r1 program's on-wire offset
// layout, which is read via an unaligned pointer cast below. Without it, Rust may
// reorder the fields and the cast would map them incorrectly.
#[repr(C)]
#[allow(dead_code)]
struct Secp256r1SignatureOffsets {
    signature_offset: u16,
    signature_instruction_index: u16,
    public_key_offset: u16,
    public_key_instruction_index: u16,
    message_data_offset: u16,
    message_data_size: u16,
    message_instruction_index: u16,
}

/// Big-endian tap counter width (bytes) at the front of the signed NDEF message.
pub const TAP_COUNTER_LEN: usize = 4;
/// Random nonce width (bytes) following the counter in the signed NDEF message.
pub const TAP_NONCE_LEN: usize = 8;
/// Exact length of the message the NFC tag signs: `counter(4 BE) || nonce(8)`.
pub const TAP_MESSAGE_LEN: usize = TAP_COUNTER_LEN + TAP_NONCE_LEN;

/// Arguments for verifying a tap via the dynamic-URL signature.
///
/// The NFC tag signs a fixed `counter || nonce` message it generates itself; it has
/// no knowledge of the transfer context. All transfer-context binding therefore comes
/// from the program: the signing pubkey is matched to the `card_instance` PDA, and the
/// monotonic `counter` extracted from the signed message provides replay protection.
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug, Clone)]
pub struct Secp256r1VerifyArgs {
    /// Index of the secp256r1 verify instruction.
    pub instruction_index: u8,
    /// Index of the signature within the secp256r1 verify instruction.
    pub signed_message_index: u8,
}

impl Secp256r1VerifyArgs {
    fn read_signature_offsets(
        data: &[u8],
        signed_message_index: u8,
    ) -> Result<Secp256r1SignatureOffsets> {
        let start = signed_message_index
            .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE as u8)
            .saturating_add(SIGNATURE_OFFSETS_START as u8);
        let start_usize = start as usize;
        let end_usize = start_usize
            .checked_add(SIGNATURE_OFFSETS_SERIALIZED_SIZE)
            .ok_or(PhygitalError::InvalidSignatureOffsets)?;

        require!(
            end_usize <= data.len(),
            PhygitalError::InvalidSignatureOffsets
        );

        const EXPECTED_STRUCT_SIZE: usize = core::mem::size_of::<Secp256r1SignatureOffsets>();
        require!(
            EXPECTED_STRUCT_SIZE == SIGNATURE_OFFSETS_SERIALIZED_SIZE,
            PhygitalError::InvalidSignatureOffsets
        );

        let offsets = unsafe {
            core::ptr::read_unaligned(
                data.as_ptr().add(start_usize) as *const Secp256r1SignatureOffsets
            )
        };

        Ok(offsets)
    }

    fn extract_message_data<'a>(
        data: &'a [u8],
        offsets: &Secp256r1SignatureOffsets,
    ) -> Result<&'a [u8]> {
        let message_offset = offsets.message_data_offset as usize;
        let message_size = offsets.message_data_size as usize;
        let message_end = message_offset
            .checked_add(message_size)
            .ok_or(PhygitalError::InvalidSignatureOffsets)?;

        require!(
            message_end <= data.len(),
            PhygitalError::InvalidSignatureOffsets
        );
        require!(
            message_size == TAP_MESSAGE_LEN,
            PhygitalError::InvalidTapMessage
        );

        Ok(data
            .get(message_offset..message_end)
            .ok_or(PhygitalError::InvalidSignatureOffsets)?)
    }

    fn extract_public_key_data<'a>(
        data: &'a [u8],
        offsets: &Secp256r1SignatureOffsets,
    ) -> Result<&'a [u8]> {
        let public_key_offset = offsets.public_key_offset as usize;
        let public_key_end = public_key_offset
            .checked_add(COMPRESSED_PUBKEY_SERIALIZED_SIZE)
            .ok_or(PhygitalError::InvalidSecp256r1PublicKey)?;

        require!(
            public_key_end <= data.len(),
            PhygitalError::InvalidSecp256r1PublicKey
        );

        Ok(data
            .get(public_key_offset..public_key_end)
            .ok_or(PhygitalError::InvalidSecp256r1PublicKey)?)
    }

    /// Reads the preceding instruction, validates it is the secp256r1 verify program,
    /// and returns the signature offsets for `signed_message_index`.
    fn load_instruction_offsets<'a>(
        &self,
        instructions_sysvar: &UncheckedAccount,
        instruction_data: &'a mut Vec<u8>,
    ) -> Result<Secp256r1SignatureOffsets> {
        require!(
            instructions_sysvar.key() == INSTRUCTIONS_SYSVAR_ID,
            PhygitalError::MissingInstructionsSysvar
        );

        let instruction =
            load_instruction_at_checked(self.instruction_index.into(), instructions_sysvar)?;

        require!(
            instruction.program_id == SECP256R1_PROGRAM_ID,
            PhygitalError::InvalidSecp256r1Instruction
        );

        *instruction_data = instruction.data;

        let num_signatures = *instruction_data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        Self::read_signature_offsets(instruction_data, self.signed_message_index)
    }

    pub fn extract_public_key_from_instruction(
        &self,
        instructions_sysvar: &UncheckedAccount,
    ) -> Result<Secp256r1Pubkey> {
        let mut data = Vec::new();
        let offsets = self.load_instruction_offsets(instructions_sysvar, &mut data)?;

        let public_key_bytes = Self::extract_public_key_data(&data, &offsets)?;

        let extracted_pubkey: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = public_key_bytes
            .try_into()
            .map_err(|_| PhygitalError::InvalidSecp256r1PublicKey)?;

        Ok(Secp256r1Pubkey(extracted_pubkey))
    }

    /// Extracts and returns the monotonic tap counter from the signed `counter || nonce`
    /// message verified by the preceding secp256r1 instruction.
    ///
    /// The secp256r1 precompile has already verified the ECDSA signature over this exact
    /// message against the public key, so trusting the message contents here is sound.
    pub fn extract_tap_counter(&self, instructions_sysvar: &UncheckedAccount) -> Result<u32> {
        let mut data = Vec::new();
        let offsets = self.load_instruction_offsets(instructions_sysvar, &mut data)?;

        let message = Self::extract_message_data(&data, &offsets)?;

        let counter_bytes: [u8; TAP_COUNTER_LEN] = message[..TAP_COUNTER_LEN]
            .try_into()
            .map_err(|_| error!(PhygitalError::InvalidTapMessage))?;

        Ok(u32::from_be_bytes(counter_bytes))
    }
}
