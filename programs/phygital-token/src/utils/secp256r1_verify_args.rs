use anchor_lang::prelude::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use solana_instructions_sysvar::get_instruction_relative;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::{
    error::PhygitalError,
    utils::{
        action_type::ActionType,
        secp256r1_pubkey::{
            Secp256r1Pubkey, COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID,
            SIGNATURE_OFFSETS_SERIALIZED_SIZE, SIGNATURE_OFFSETS_START,
        },
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

/// Minimum WebAuthn authenticator data: rpIdHash (32) + flags (1) + signCount (4).
pub const AUTH_DATA_MIN_LEN: usize = 37;
const AUTH_DATA_FLAGS_OFFSET: usize = 32;
const CLIENT_DATA_HASH_LEN: usize = 32;
const FLAG_USER_PRESENT: u8 = 0x01;
const MIN_SIGNED_MESSAGE_LEN: usize = AUTH_DATA_MIN_LEN + CLIENT_DATA_HASH_LEN;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug, Clone)]
pub struct Secp256r1VerifyArgs {
    pub verify_args_relative_index: i64,
    pub signed_message_index: u8,
    pub slot_number: u64,
    pub client_data_json: Vec<u8>,
}

pub struct ChallengeArgs {
    pub message_hash: [u8; 32],
    pub action_type: ActionType,
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
            message_size >= MIN_SIGNED_MESSAGE_LEN,
            PhygitalError::InvalidSignatureOffsets
        );

        Ok(data
            .get(message_offset..message_end)
            .ok_or(PhygitalError::InvalidSignatureOffsets)?)
    }

    fn verify_user_presence_from_instruction_data(&self, data: &[u8]) -> Result<()> {
        let num_signatures = *data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        let offsets = Self::read_signature_offsets(data, self.signed_message_index)?;
        let message_offset = offsets.message_data_offset as usize;
        let message_size = offsets.message_data_size as usize;

        require!(
            message_size >= MIN_SIGNED_MESSAGE_LEN,
            PhygitalError::InvalidAuthenticatorData
        );

        let flags_offset = message_offset
            .checked_add(AUTH_DATA_FLAGS_OFFSET)
            .ok_or(PhygitalError::InvalidAuthenticatorData)?;

        let flags = *data
            .get(flags_offset)
            .ok_or(PhygitalError::InvalidAuthenticatorData)?;

        require!(
            flags & FLAG_USER_PRESENT != 0,
            PhygitalError::UserPresenceNotVerified
        );

        Ok(())
    }

    fn claim_secp256r1_instruction_data(&self, data: Vec<u8>) -> Result<Vec<u8>> {
        let num_signatures = *data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        Self::read_signature_offsets(data.as_slice(), self.signed_message_index)?;
        Ok(data)
    }

    /// Finds the most recent prior secp256r1 verify instruction, checking the immediately
    /// preceding instruction first (the common case) then scanning further back.
    fn find_secp256r1_instruction_data(
        &self,
        instructions_sysvar: &UncheckedAccount,
    ) -> Result<Vec<u8>> {
        require!(
            instructions_sysvar.key() == INSTRUCTIONS_SYSVAR_ID,
            PhygitalError::MissingInstructionsSysvar
        );

        let account_info = instructions_sysvar.to_account_info();

        let instruction = get_instruction_relative(self.verify_args_relative_index, &account_info)?;

        if instruction.program_id.as_ref() == SECP256R1_PROGRAM_ID.as_ref() {
            return self.claim_secp256r1_instruction_data(instruction.data);
        }

        err!(PhygitalError::InvalidSecp256r1Instruction)
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

    fn extract_challenge_from_client_data_json(&self) -> Result<[u8; 32]> {
        let client_data_str = std::str::from_utf8(&self.client_data_json)
            .map_err(|_| PhygitalError::UnableToParseClientData)?;

        let client_data: serde_json::Value = serde_json::from_str(client_data_str)
            .map_err(|_| PhygitalError::UnableToParseClientData)?;

        let challenge_b64 = client_data
            .get("challenge")
            .and_then(|v| v.as_str())
            .ok_or(PhygitalError::UnableToParseClientData)?;

        let challenge_bytes = URL_SAFE_NO_PAD
            .decode(challenge_b64)
            .map_err(|_| PhygitalError::UnableToParseClientData)?;

        require!(
            challenge_bytes.len() == 32,
            PhygitalError::UnableToParseClientData
        );

        Ok(challenge_bytes
            .try_into()
            .map_err(|_| PhygitalError::UnableToParseClientData)?)
    }

    fn fetch_slot_hash(&self, slot_hashes_account: &UncheckedAccount) -> Result<[u8; 32]> {
        let data = slot_hashes_account
            .try_borrow_data()
            .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?;

        require!(data.len() >= 8, PhygitalError::InvalidSysvarDataFormat);

        let num_slot_hashes = u64::from_le_bytes(
            data[..8]
                .try_into()
                .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?,
        ) as usize;

        if num_slot_hashes == 0 {
            return err!(PhygitalError::InvalidSysvarDataFormat);
        }

        let mut left = 0usize;
        let mut right = num_slot_hashes;

        while left < right {
            let mid = left + (right - left) / 2;

            let pos = 8usize
                .checked_add(
                    mid.checked_mul(40)
                        .ok_or(PhygitalError::InvalidSysvarDataFormat)?,
                )
                .ok_or(PhygitalError::InvalidSysvarDataFormat)?;

            require!(
                pos.checked_add(40)
                    .ok_or(PhygitalError::InvalidSysvarDataFormat)?
                    <= data.len(),
                PhygitalError::InvalidSysvarDataFormat
            );

            let slot = u64::from_le_bytes(
                data[pos..pos + 8]
                    .try_into()
                    .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?,
            );

            if slot == self.slot_number {
                let hash_bytes = &data[pos + 8..pos + 40];
                return Ok(hash_bytes
                    .try_into()
                    .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?);
            } else if slot > self.slot_number {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        err!(PhygitalError::InvalidSlotHash)
    }

    pub fn extract_public_key_from_instruction(
        &self,
        instructions_sysvar: &UncheckedAccount,
    ) -> Result<Secp256r1Pubkey> {
        let data = self.find_secp256r1_instruction_data(instructions_sysvar)?;

        let num_signatures = *data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        let offsets = Self::read_signature_offsets(&data, self.signed_message_index)?;
        let public_key_bytes = Self::extract_public_key_data(&data, &offsets)?;

        let extracted_pubkey: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = public_key_bytes
            .try_into()
            .map_err(|_| PhygitalError::InvalidSecp256r1PublicKey)?;

        Ok(Secp256r1Pubkey(extracted_pubkey))
    }

    pub fn verify_webauthn<'info>(
        &self,
        slot_hashes: &UncheckedAccount<'info>,
        instructions_sysvar: &UncheckedAccount<'info>,
        challenge_args: ChallengeArgs,
    ) -> Result<()> {
        let slot_hash = self.fetch_slot_hash(slot_hashes)?;

        let mut buffer = Vec::new();
        buffer.extend_from_slice(challenge_args.action_type.to_bytes());
        buffer.extend_from_slice(&challenge_args.message_hash);
        buffer.extend_from_slice(&slot_hash);

        let expected_challenge: [u8; 32] = Sha256::digest(&buffer).into();

        let extracted_challenge = self.extract_challenge_from_client_data_json()?;

        require!(
            extracted_challenge == expected_challenge,
            PhygitalError::ChallengeHashMismatch
        );

        let secp256r1_data = self.find_secp256r1_instruction_data(instructions_sysvar)?;

        self.verify_user_presence_from_instruction_data(&secp256r1_data)?;

        let offsets = Self::read_signature_offsets(&secp256r1_data, self.signed_message_index)?;
        let message = Self::extract_message_data(&secp256r1_data, &offsets)?;
        let client_data_hash: [u8; 32] = message[(message.len() - CLIENT_DATA_HASH_LEN)..]
            .try_into()
            .map_err(|_| PhygitalError::InvalidSignatureOffsets)?;

        let expected_client_data_hash: [u8; 32] = Sha256::digest(&self.client_data_json).into();

        require!(
            client_data_hash == expected_client_data_hash,
            PhygitalError::ClientDataHashMismatch
        );

        Ok(())
    }
}
