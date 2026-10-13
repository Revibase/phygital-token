//! Reading the secp256r1 precompile instruction.
//!
//! The precompile (SIMD-0075) checks up to eight `(signature, public key,
//! message)` triples before any program runs, and fails the whole transaction
//! if one is invalid. Its data is a one-byte count, one padding byte, then one
//! 14-byte offsets entry per signature (seven little-endian `u16`s) that locate
//! each part.
//!
//! This module returns the public key and message of one entry so the caller
//! can trust them as signed. That holds only because every entry read here must
//! point into the precompile instruction's own data; see
//! [`read_signature_offsets`].

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");
/// SEC1 compressed P-256 public key: a `0x02`/`0x03` prefix and the x coordinate.
pub const COMPRESSED_PUBKEY_SERIALIZED_SIZE: usize = 33;
/// One offsets entry: seven `u16`s.
pub const SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;
/// The count byte and a padding byte precede the offsets table.
pub const SIGNATURE_OFFSETS_START: usize = 2;

/// `*_instruction_index` value that makes the secp256r1 precompile read from its
/// own instruction data.
const CURRENT_INSTRUCTION: u16 = u16::MAX;

/// One entry of the secp256r1 precompile's offsets table: seven little-endian
/// `u16`s. The signature offset is not needed here and is not kept.
struct Secp256r1SignatureOffsets {
    signature_instruction_index: u16,
    public_key_offset: u16,
    public_key_instruction_index: u16,
    message_data_offset: u16,
    message_data_size: u16,
    message_instruction_index: u16,
}

/// The public key and signed message of entry `signed_message_index`, which
/// must be at least `min_message_len` bytes long.
pub(super) fn signed_public_key_and_message(
    data: &[u8],
    signed_message_index: u8,
    min_message_len: usize,
) -> Result<([u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE], &[u8])> {
    let offsets = validated_offsets(data, signed_message_index)?;
    let public_key_bytes = extract_public_key_data(data, &offsets)?;
    let public_key: [u8; COMPRESSED_PUBKEY_SERIALIZED_SIZE] = public_key_bytes
        .try_into()
        .map_err(|_| PhygitalError::InvalidSecp256r1PublicKey)?;
    let message = extract_message_data(data, &offsets, min_message_len)?;
    Ok((public_key, message))
}

/// Reads entry `signed_message_index` of the offsets table and requires all
/// three of its instruction indexes to name the precompile instruction
/// itself. The precompile verifies the signature over the key and message
/// found in whichever instruction each index names, while this program reads
/// the key and message from the precompile instruction's own data: an index
/// naming another instruction would let a signature by one key vouch for a
/// different key placed at the same offsets here.
fn read_signature_offsets(
    data: &[u8],
    signed_message_index: u8,
) -> Result<Secp256r1SignatureOffsets> {
    let start = usize::from(signed_message_index)
        .checked_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE)
        .and_then(|offset| offset.checked_add(SIGNATURE_OFFSETS_START))
        .ok_or(PhygitalError::InvalidSignatureOffsets)?;
    let field = |index: usize| -> Result<u16> {
        let at = index
            .checked_mul(2)
            .and_then(|offset| offset.checked_add(start))
            .ok_or(PhygitalError::InvalidSignatureOffsets)?;
        let bytes: [u8; 2] = data
            .get(at..at.saturating_add(2))
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or(PhygitalError::InvalidSignatureOffsets)?;
        Ok(u16::from_le_bytes(bytes))
    };
    let offsets = Secp256r1SignatureOffsets {
        signature_instruction_index: field(1)?,
        public_key_offset: field(2)?,
        public_key_instruction_index: field(3)?,
        message_data_offset: field(4)?,
        message_data_size: field(5)?,
        message_instruction_index: field(6)?,
    };
    require!(
        offsets.signature_instruction_index == CURRENT_INSTRUCTION
            && offsets.public_key_instruction_index == CURRENT_INSTRUCTION
            && offsets.message_instruction_index == CURRENT_INSTRUCTION,
        PhygitalError::InvalidSignatureOffsets
    );
    Ok(offsets)
}

fn extract_message_data<'a>(
    data: &'a [u8],
    offsets: &Secp256r1SignatureOffsets,
    min_message_len: usize,
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
        message_size >= min_message_len,
        PhygitalError::InvalidSignatureOffsets
    );

    Ok(data
        .get(message_offset..message_end)
        .ok_or(PhygitalError::InvalidSignatureOffsets)?)
}

fn validated_offsets(data: &[u8], signed_message_index: u8) -> Result<Secp256r1SignatureOffsets> {
    let num_signatures = *data
        .first()
        .ok_or(PhygitalError::InvalidSecp256r1Instruction)?;

    require!(
        signed_message_index < num_signatures,
        PhygitalError::SignatureIndexOutOfBounds
    );

    read_signature_offsets(data, signed_message_index)
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

#[cfg(test)]
mod tests {
    use super::*;

    const MIN_MESSAGE: usize = 4;

    /// A precompile instruction with one entry whose key and message follow
    /// the table, built field by field like the SDK does.
    fn instruction(indexes: [u16; 3], message: &[u8]) -> Vec<u8> {
        let key_at = SIGNATURE_OFFSETS_START + SIGNATURE_OFFSETS_SERIALIZED_SIZE;
        let signature_at = key_at + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
        let message_at = signature_at + 64;
        let mut data = vec![1, 0];
        for field in [
            signature_at as u16,
            indexes[0],
            key_at as u16,
            indexes[1],
            message_at as u16,
            message.len() as u16,
            indexes[2],
        ] {
            data.extend_from_slice(&field.to_le_bytes());
        }
        data.extend_from_slice(&[2; COMPRESSED_PUBKEY_SERIALIZED_SIZE]);
        data.extend_from_slice(&[7; 64]);
        data.extend_from_slice(message);
        data
    }

    fn code(result: Result<impl Sized>) -> u32 {
        match result {
            Err(Error::AnchorError(e)) => e.error_code_number,
            _ => panic!("expected an Anchor error"),
        }
    }

    #[test]
    fn reads_key_and_message_of_a_self_contained_entry() {
        let data = instruction([CURRENT_INSTRUCTION; 3], b"message");
        let (key, message) = signed_public_key_and_message(&data, 0, MIN_MESSAGE).unwrap();
        assert_eq!(key, [2; COMPRESSED_PUBKEY_SERIALIZED_SIZE]);
        assert_eq!(message, b"message");
    }

    #[test]
    fn every_instruction_index_must_name_the_precompile_itself() {
        let offsets = PhygitalError::InvalidSignatureOffsets as u32 + 6000;
        for position in 0..3 {
            let mut indexes = [CURRENT_INSTRUCTION; 3];
            indexes[position] = 0;
            let data = instruction(indexes, b"message");
            assert_eq!(
                code(signed_public_key_and_message(&data, 0, MIN_MESSAGE)),
                offsets
            );
        }
    }

    #[test]
    fn rejects_out_of_range_entries_and_short_messages() {
        let data = instruction([CURRENT_INSTRUCTION; 3], b"message");
        assert_eq!(
            code(signed_public_key_and_message(&data, 1, MIN_MESSAGE)),
            PhygitalError::SignatureIndexOutOfBounds as u32 + 6000
        );
        assert_eq!(
            code(signed_public_key_and_message(&data, 0, 8)),
            PhygitalError::InvalidSignatureOffsets as u32 + 6000
        );
        assert_eq!(
            code(signed_public_key_and_message(&data[..10], 0, MIN_MESSAGE)),
            PhygitalError::InvalidSignatureOffsets as u32 + 6000
        );
        assert_eq!(
            code(signed_public_key_and_message(&[], 0, MIN_MESSAGE)),
            PhygitalError::InvalidSecp256r1Instruction as u32 + 6000
        );
    }

    proptest::proptest! {
        #[test]
        fn never_panics(data in proptest::collection::vec(proptest::prelude::any::<u8>(), 0..400), index in 0u8..=255) {
            let _ = signed_public_key_and_message(&data, index, MIN_MESSAGE);
        }
    }
}
