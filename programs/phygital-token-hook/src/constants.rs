use anchor_lang::prelude::*;

pub const PROGRAM_AUTHORITY_SEED: &[u8] = "program_authority".as_bytes();

/// Main phygital-token program — `program_authority` PDA is derived from this id.
pub const PHYGITAL_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("E6KubRhYXkWVegxS68od3C4DSEUJGUcuY68M2wdRJH3F");
