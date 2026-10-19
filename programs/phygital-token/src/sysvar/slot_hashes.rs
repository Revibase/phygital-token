//! Looking up a recent slot's hash in the SlotHashes sysvar.
//!
//! Layout: a little-endian `u64` entry count, then entries of `(slot: u64,
//! hash: [u8; 32])` ordered by slot, newest first. The runtime keeps the latest
//! 512 slots, so a challenge built from a slot hash can only be verified while
//! that slot is in this window.

use anchor_lang::prelude::*;

use crate::error::PhygitalError;

/// The `u64` entry count.
const HEADER_LEN: usize = 8;
/// `slot: u64`.
const SLOT_LEN: usize = 8;
/// `slot: u64` followed by `hash: [u8; 32]`.
const ENTRY_LEN: usize = SLOT_LEN + 32;

/// The hash recorded for `slot_number`, found by binary search over the
/// descending entries. Fails with `InvalidSlotHash` once the slot has aged out.
pub(crate) fn fetch_slot_hash(
    slot_hashes_account: &UncheckedAccount,
    slot_number: u64,
) -> Result<[u8; 32]> {
    let data = slot_hashes_account
        .try_borrow_data()
        .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?;

    require!(
        data.len() >= HEADER_LEN,
        PhygitalError::InvalidSysvarDataFormat
    );

    let num_slot_hashes = u64::from_le_bytes(
        data[..HEADER_LEN]
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

        let pos = HEADER_LEN
            .checked_add(
                mid.checked_mul(ENTRY_LEN)
                    .ok_or(PhygitalError::InvalidSysvarDataFormat)?,
            )
            .ok_or(PhygitalError::InvalidSysvarDataFormat)?;

        require!(
            pos.checked_add(ENTRY_LEN)
                .ok_or(PhygitalError::InvalidSysvarDataFormat)?
                <= data.len(),
            PhygitalError::InvalidSysvarDataFormat
        );

        let slot = u64::from_le_bytes(
            data[pos..pos + SLOT_LEN]
                .try_into()
                .map_err(|_| PhygitalError::InvalidSysvarDataFormat)?,
        );

        if slot == slot_number {
            let hash_bytes = &data[pos + SLOT_LEN..pos + ENTRY_LEN];
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
