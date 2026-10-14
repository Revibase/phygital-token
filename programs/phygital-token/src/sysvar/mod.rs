//! In-place readers for the sysvars the program inspects. Callers check the
//! sysvar account address in their `Accounts` constraints.

mod instructions;
mod slot_hashes;

pub(crate) use instructions::{instruction_parts, relative_instruction_parts};
pub(crate) use slot_hashes::fetch_slot_hash;
