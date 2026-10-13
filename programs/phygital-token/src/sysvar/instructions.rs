//! Reading the Instructions sysvar in place.
//!
//! Layout: `u16` instruction count; one `u16` byte offset per instruction;
//! then each instruction as `u16` account count, per account one flags byte
//! and a 32-byte key, the 32-byte program id, a `u16` data length and the data.
//! The last two bytes hold the index of the currently executing top-level
//! instruction. All integers are little-endian.
//!
//! Reading in place avoids allocating an `Instruction` (the bump allocator
//! never frees).

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

/// One account entry: a flags byte and a 32-byte key.
const ACCOUNT_META_LEN: usize = 33;

fn read_u16_at(data: &[u8], offset: usize) -> Result<u16> {
    let bytes: [u8; 2] = data
        .get(offset..offset.saturating_add(2))
        .ok_or(PhygitalError::InvalidSysvarDataFormat)?
        .try_into()
        .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?;
    Ok(u16::from_le_bytes(bytes))
}

/// Program id and data of the top-level instruction `relative_index` positions
/// away from the current one.
pub(crate) fn relative_instruction_parts(
    sysvar: &[u8],
    relative_index: i64,
) -> Result<(&[u8], &[u8])> {
    require!(sysvar.len() >= 2, PhygitalError::InvalidSysvarDataFormat);
    let current = u16::from_le_bytes(
        sysvar[sysvar.len() - 2..]
            .try_into()
            .map_err(|_| error!(PhygitalError::InvalidSysvarDataFormat))?,
    ) as i64;
    let index = current.saturating_add(relative_index);
    require!(index >= 0, PhygitalError::InvalidSecp256r1Instruction);
    instruction_parts(sysvar, index as usize)
}

/// Program id and data of transaction instruction `index`.
///
/// An out-of-range `index` fails with `InvalidSecp256r1Instruction`, since the
/// main caller is looking for the precompile instruction.
pub(crate) fn instruction_parts(sysvar: &[u8], index: usize) -> Result<(&[u8], &[u8])> {
    let num_instructions = read_u16_at(sysvar, 0)? as usize;
    require!(
        index < num_instructions,
        PhygitalError::InvalidSecp256r1Instruction
    );

    let start = read_u16_at(sysvar, 2usize.saturating_add(index.saturating_mul(2)))? as usize;
    let num_accounts = read_u16_at(sysvar, start)? as usize;
    let accounts_bytes = num_accounts
        .checked_mul(ACCOUNT_META_LEN)
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

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Serializes instructions the way the runtime lays out the sysvar.
    fn sysvar(instructions: &[(u8, [u8; 32], &[u8])], current: u16) -> Vec<u8> {
        let mut body = Vec::new();
        let mut offsets = Vec::new();
        let header = 2 + 2 * instructions.len();
        for (accounts, program, data) in instructions {
            offsets.push((header + body.len()) as u16);
            body.extend_from_slice(&u16::from(*accounts).to_le_bytes());
            for _ in 0..*accounts {
                body.push(0);
                body.extend_from_slice(&[9; 32]);
            }
            body.extend_from_slice(program);
            body.extend_from_slice(&(data.len() as u16).to_le_bytes());
            body.extend_from_slice(data);
        }
        let mut out = (instructions.len() as u16).to_le_bytes().to_vec();
        for offset in offsets {
            out.extend_from_slice(&offset.to_le_bytes());
        }
        out.extend_from_slice(&body);
        out.extend_from_slice(&current.to_le_bytes());
        out
    }

    #[test]
    fn finds_program_and_data_by_absolute_and_relative_index() {
        let data = sysvar(&[(2, [1; 32], b"first"), (0, [2; 32], b"second")], 1);
        assert_eq!(
            instruction_parts(&data, 0).unwrap(),
            (&[1u8; 32][..], &b"first"[..])
        );
        assert_eq!(
            relative_instruction_parts(&data, -1).unwrap(),
            (&[1u8; 32][..], &b"first"[..])
        );
        assert_eq!(
            relative_instruction_parts(&data, 0).unwrap(),
            (&[2u8; 32][..], &b"second"[..])
        );
        assert!(relative_instruction_parts(&data, 1).is_err());
        assert!(relative_instruction_parts(&data, -2).is_err());
    }

    proptest! {
        #[test]
        fn never_panics(data in proptest::collection::vec(any::<u8>(), 0..300), index in 0usize..10, relative in -5i64..5) {
            let _ = instruction_parts(&data, index);
            let _ = relative_instruction_parts(&data, relative);
        }
    }
}
