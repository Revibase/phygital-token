use anchor_lang::prelude::*;

pub const PROGRAM_AUTHORITY_SEED: &[u8] = "program_authority".as_bytes();

/// Main phygital-token program — `program_authority` PDA is derived from this id.
pub const PHYGITAL_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("DdwhetyqgSB56XVcR33ySG5dFmvwbjSc5aSMHRg5Bk6A");
