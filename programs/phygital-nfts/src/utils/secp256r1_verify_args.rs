use anchor_lang::prelude::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use solana_instructions_sysvar::get_instruction_relative;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::{
    error::PhygitalError,
    utils::{
        secp256r1_pubkey::{
            Secp256r1Pubkey, COMPRESSED_PUBKEY_SERIALIZED_SIZE, SECP256R1_PROGRAM_ID,
            SIGNATURE_OFFSETS_SERIALIZED_SIZE, SIGNATURE_OFFSETS_START,
        },
        transfer_action_type::TransferActionType,
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

pub const MAX_ORIGIN_LEN: usize = 256;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug, Clone)]
pub struct Secp256r1VerifyArgs {
    pub signed_message_index: u8,
    pub slot_number: u64,
    pub origin: String,
    pub cross_origin: bool,
    pub truncated_client_data_json: Vec<u8>,
}

pub struct ChallengeArgs {
    pub domain_account: Pubkey,
    pub message_hash: [u8; 32],
    pub action_type: TransferActionType,
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
            message_size >= 64,
            PhygitalError::InvalidSignatureOffsets
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

    fn ccd_to_string(value: &str, output: &mut Vec<u8>) {
        output.push(b'"');

        for ch in value.chars() {
            match ch {
                '\u{0020}'..='\u{0021}' | '\u{0023}'..='\u{005B}' | '\u{005D}'..='\u{10FFFF}' => {
                    let mut buf = [0u8; 4];
                    let s = ch.encode_utf8(&mut buf);
                    output.extend_from_slice(s.as_bytes());
                }
                '"' => output.extend_from_slice(br#"\""#),
                '\\' => output.extend_from_slice(br#"\\"#),
                _ => {
                    output.extend_from_slice(b"\\u");
                    let code = ch as u32;
                    let hex = [
                        Self::hex_digit((code >> 12) & 0xF),
                        Self::hex_digit((code >> 8) & 0xF),
                        Self::hex_digit((code >> 4) & 0xF),
                        Self::hex_digit(code & 0xF),
                    ];
                    output.extend_from_slice(&hex);
                }
            }
        }

        output.push(b'"');
    }

    #[inline]
    fn hex_digit(n: u32) -> u8 {
        match n {
            0..=9 => b'0' + (n as u8),
            10..=15 => b'a' + ((n as u8) - 10),
            _ => unreachable!(),
        }
    }

    fn generate_client_data_json(
        &self,
        expected_origin: &String,
        expected_challenge: [u8; 32],
    ) -> Result<Vec<u8>> {
        let mut result = Vec::new();
        result.extend_from_slice(br#"{"type":"webauthn.get""#);
        result.extend_from_slice(br#","challenge":"#);
        Self::ccd_to_string(&URL_SAFE_NO_PAD.encode(expected_challenge), &mut result);
        result.extend_from_slice(br#","origin":"#);
        Self::ccd_to_string(expected_origin, &mut result);
        if self.cross_origin {
            result.extend_from_slice(br#","crossOrigin":true"#);
        } else {
            result.extend_from_slice(br#","crossOrigin":false"#);
        }
        if !self.truncated_client_data_json.is_empty() {
            result.push(b',');
            result.extend_from_slice(&self.truncated_client_data_json);
        }
        result.push(b'}');

        Ok(result)
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

    fn extract_client_data_hash_from_instruction(
        &self,
        instructions_sysvar: &UncheckedAccount,
    ) -> Result<[u8; 32]> {
        require!(
            instructions_sysvar.key() == INSTRUCTIONS_SYSVAR_ID,
            PhygitalError::MissingInstructionsSysvar
        );

        let instruction = get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id == SECP256R1_PROGRAM_ID,
            PhygitalError::InvalidSecp256r1Instruction
        );

        let data = instruction.data.as_slice();

        let num_signatures = *data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        let offsets =
            Self::read_signature_offsets(data, self.signed_message_index)?;

        let message = Self::extract_message_data(data, &offsets)?;

        Ok(message[(message.len() - 32)..]
            .try_into()
            .map_err(|_| error!(PhygitalError::InvalidSignatureOffsets))?)
    }

    pub fn extract_public_key_from_instruction(
        &self,
        instructions_sysvar: &UncheckedAccount,
    ) -> Result<Secp256r1Pubkey> {
        require!(
            instructions_sysvar.key() == INSTRUCTIONS_SYSVAR_ID,
            PhygitalError::MissingInstructionsSysvar
        );

        let instruction = get_instruction_relative(-1, instructions_sysvar)?;

        require!(
            instruction.program_id == SECP256R1_PROGRAM_ID,
            PhygitalError::InvalidSecp256r1Instruction
        );

        let data = instruction.data.as_slice();
        let num_signatures = *data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        let offsets =
            Self::read_signature_offsets(data, self.signed_message_index)?;

        let public_key_bytes = Self::extract_public_key_data(data, &offsets)?;

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
        require!(
            !self.origin.is_empty() && self.origin.len() <= MAX_ORIGIN_LEN,
            PhygitalError::MaxLengthExceeded
        );

        let client_data_hash =
            self.extract_client_data_hash_from_instruction(instructions_sysvar)?;

        let slot_hash = self.fetch_slot_hash(slot_hashes)?;

        let mut buffer = Vec::new();
        buffer.extend_from_slice(challenge_args.action_type.to_bytes());
        buffer.extend_from_slice(challenge_args.domain_account.as_ref());
        buffer.extend_from_slice(&challenge_args.message_hash);
        buffer.extend_from_slice(&slot_hash);

        let expected_challenge: [u8; 32] = Sha256::digest(&buffer).into();

        let generated_client_data_json =
            self.generate_client_data_json(&self.origin, expected_challenge)?;

        let expected_client_data_hash: [u8; 32] =
            Sha256::digest(&generated_client_data_json).into();

        require!(
            client_data_hash == expected_client_data_hash,
            PhygitalError::ClientDataHashMismatch
        );

        Ok(())
    }
}
