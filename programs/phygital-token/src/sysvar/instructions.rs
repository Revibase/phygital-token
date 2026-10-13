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
