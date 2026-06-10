use anchor_lang::prelude::*;

pub const PROGRAM_AUTHORITY_SEED: &[u8] = "program_authority".as_bytes();

/// Main phygital-nfts program — `program_authority` PDA is derived from this id.
pub const PHYGITAL_NFTS_PROGRAM_ID: Pubkey =
    pubkey!("3qr6jpvHGuJ1tDk49gRtPH8rndTRfa1M7PpqMVmx1un1");
