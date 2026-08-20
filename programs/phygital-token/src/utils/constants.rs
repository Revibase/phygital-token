use anchor_lang::prelude::*;

pub const PHYGITAL_TOKEN_SEED: &[u8] = b"token";

/// Sole wallet allowed to call `initialize` (Squads vault-0 on mainnet).
pub const ADMIN: Pubkey = pubkey!("G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF");
