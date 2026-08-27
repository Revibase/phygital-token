use anchor_lang::prelude::*;
use solana_sha256_hasher::{hash, hashv};

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

const _: () = assert!(
    core::mem::size_of::<Secp256r1SignatureOffsets>() == SIGNATURE_OFFSETS_SERIALIZED_SIZE
);

/// Minimum WebAuthn authenticator data: rpIdHash (32) + flags (1) + signCount (4).
pub const AUTH_DATA_MIN_LEN: usize = 37;
const AUTH_DATA_FLAGS_OFFSET: usize = 32;
const AUTH_DATA_SIGN_COUNT_OFFSET: usize = 33;
const CLIENT_DATA_HASH_LEN: usize = 32;
const FLAG_USER_PRESENT: u8 = 0x01;
const MIN_SIGNED_MESSAGE_LEN: usize = AUTH_DATA_MIN_LEN + CLIENT_DATA_HASH_LEN;
const CHALLENGE_B64URL_LEN: usize = 43;
const JSON_CHALLENGE_KEY: &[u8] = br#""challenge":""#;
const JSON_ORIGIN_KEY: &[u8] = br#""origin":""#;

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Debug, Clone)]
pub struct Secp256r1VerifyArgs {
    pub verify_args_relative_index: i64,
    pub signed_message_index: u8,
    pub client_data_json: Vec<u8>,
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

        let offsets = unsafe {
            core::ptr::read_unaligned(
                data.as_ptr().add(start_usize) as *const Secp256r1SignatureOffsets,
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

    fn validated_offsets(&self, data: &[u8]) -> Result<Secp256r1SignatureOffsets> {
        let num_signatures = *data
            .first()
            .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

        require!(
            self.signed_message_index < num_signatures,
            PhygitalError::SignatureIndexOutOfBounds
        );

        Self::read_signature_offsets(data, self.signed_message_index)
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

    /// Looks up `slot_number` in the SlotHashes sysvar. Used by callers (e.g.
    /// `transfer_ownership`) that bind WebAuthn challenges to slot freshness.
    pub fn fetch_slot_hash(
        slot_hashes_account: &UncheckedAccount,
        slot_number: u64,
    ) -> Result<[u8; 32]> {
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

            if slot == slot_number {
                let hash_bytes = &data[pos + 8..pos + 40];
                return Ok(hash_bytes
                    .try_into()
                    .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?);
            } else if slot > slot_number {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        err!(PhygitalError::InvalidSlotHash)
    }

    /// One sysvar walk: pubkey, signCount, user-presence, clientDataJSON hash,
    /// and optional rpId / origin-list bindings.
    pub fn verify_webauthn_assertion(
        &self,
        instructions_sysvar: &UncheckedAccount,
        expected_challenge: [u8; 32],
        expected_rp_id: Option<&str>,
        expected_origins: Option<&[String]>,
    ) -> Result<(Secp256r1Pubkey, u32)> {
        let extracted_challenge = extract_challenge_from_client_data_json(&self.client_data_json)?;
        require!(
            extracted_challenge == expected_challenge,
            PhygitalError::ChallengeHashMismatch
        );

        if let Some(expected_origins) = expected_origins {
            let origin = json_quoted_value(&self.client_data_json, JSON_ORIGIN_KEY)?;
            require!(
                expected_origins.iter().any(|expected| origin == expected.as_bytes()),
                PhygitalError::OriginMismatch
            );
        }

        let sysvar = instructions_sysvar.try_borrow_data()?;
        let (program_id, data) =
            relative_instruction_parts(&sysvar, self.verify_args_relative_index)?;
        require!(
            program_id == SECP256R1_PROGRAM_ID.as_ref(),
            PhygitalError::InvalidSecp256r1Instruction
        );

        let offsets = self.validated_offsets(data)?;
        let public_key_bytes = Self::extract_public_key_data(data, &offsets)?;
        let extracted_pubkey: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = public_key_bytes
            .try_into()
            .map_err(|_| PhygitalError::InvalidSecp256r1PublicKey)?;

        let message = Self::extract_message_data(data, &offsets)?;
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

        if let Some(rp_id) = expected_rp_id {
            let expected_hash = hashv(&[rp_id.as_bytes()]).to_bytes();
            let actual_hash: [u8; 32] = message[..32]
                .try_into()
                .map_err(|_| PhygitalError::InvalidAuthenticatorData)?;
            require!(expected_hash == actual_hash, PhygitalError::RpIdMismatch);
        }

        Ok((Secp256r1Pubkey(extracted_pubkey), sign_count))
    }
}

fn extract_challenge_from_client_data_json(client_data_json: &[u8]) -> Result<[u8; 32]> {
    let challenge_b64 = json_quoted_value(client_data_json, JSON_CHALLENGE_KEY)?;
    decode_base64url_32(challenge_b64)
}

fn read_u16_at(data: &[u8], offset: usize) -> Result<u16> {
    let bytes: [u8; 2] = data
        .get(offset..offset.saturating_add(2))
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?
        .try_into()
        .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?;
    Ok(u16::from_le_bytes(bytes))
}

/// Borrow the program id and data of the instruction at `current + relative_index`
/// from the instructions sysvar, without allocating an `Instruction`.
fn relative_instruction_parts(sysvar: &[u8], relative_index: i64) -> Result<(&[u8], &[u8])> {
    require!(sysvar.len() >= 2, PhygitalError::InvalidSysvarDataFormat);

    let current = u16::from_le_bytes(
        sysvar[sysvar.len() - 2..]
            .try_into()
            .map_err(|_| error!(PhygitalError::InvalidSysvarDataFormat))?,
    ) as i64;
    let index = current.saturating_add(relative_index);
    require!(index >= 0, PhygitalError::InvalidSecp256r1Instruction);
    let index = index as usize;

    let num_instructions = read_u16_at(sysvar, 0)? as usize;
    require!(
        index < num_instructions,
        PhygitalError::InvalidSecp256r1Instruction
    );

    let start = read_u16_at(sysvar, 2usize.saturating_add(index.saturating_mul(2)))? as usize;
    let num_accounts = read_u16_at(sysvar, start)? as usize;
    let accounts_bytes = num_accounts
        .checked_mul(33)
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?;
    let program_id_off = start
        .checked_add(2)
        .and_then(|pos| pos.checked_add(accounts_bytes))
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?;
    let program_id = sysvar
        .get(program_id_off..program_id_off.saturating_add(32))
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?;
    let data_len_off = program_id_off
        .checked_add(32)
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?;
    let data_len = read_u16_at(sysvar, data_len_off)? as usize;
    let data_off = data_len_off
        .checked_add(2)
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?;
    let data = sysvar
        .get(data_off..data_off.saturating_add(data_len))
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?;
    Ok((program_id, data))
}

fn json_quoted_value<'a>(json: &'a [u8], key_with_colon_quote: &[u8]) -> Result<&'a [u8]> {
    let start = json
        .windows(key_with_colon_quote.len())
        .position(|window| window == key_with_colon_quote)
        .ok_or(PhygitalError::UnableToParseClientData)?;
    let val_start = start
        .checked_add(key_with_colon_quote.len())
        .ok_or(PhygitalError::UnableToParseClientData)?;
    let mut i = val_start;
    while i < json.len() {
        match json[i] {
            b'\\' => {
                i = i
                    .checked_add(2)
                    .ok_or(PhygitalError::UnableToParseClientData)?;
            }
            b'"' => return Ok(&json[val_start..i]),
            _ => i += 1,
        }
    }
    err!(PhygitalError::UnableToParseClientData)
}

fn b64url_val(c: u8) -> Result<u8> {
    Ok(match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'-' => 62,
        b'_' => 63,
        _ => return err!(PhygitalError::UnableToParseClientData),
    })
}

/// Decode an unpadded base64url 32-byte challenge (43 characters).
fn decode_base64url_32(input: &[u8]) -> Result<[u8; 32]> {
    require!(
        input.len() == CHALLENGE_B64URL_LEN,
        PhygitalError::UnableToParseClientData
    );

    let mut out = [0u8; 32];
    let mut o = 0usize;
    let mut i = 0usize;
    while i + 4 <= 40 {
        let a = b64url_val(input[i])?;
        let b = b64url_val(input[i + 1])?;
        let c = b64url_val(input[i + 2])?;
        let d = b64url_val(input[i + 3])?;
        out[o] = (a << 2) | (b >> 4);
        out[o + 1] = (b << 4) | (c >> 2);
        out[o + 2] = (c << 6) | d;
        o += 3;
        i += 4;
    }

    let a = b64url_val(input[40])?;
    let b = b64url_val(input[41])?;
    let c = b64url_val(input[42])?;
    out[30] = (a << 2) | (b >> 4);
    out[31] = (b << 4) | (c >> 2);
    Ok(out)
}
