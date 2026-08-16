use anchor_lang::prelude::*;

pub const ASSET_SEED: &[u8] = b"asset";

/// Sole wallet allowed to call `initialize` (Squads vault-0 on mainnet).
pub const INITIALIZE_AUTHORITY: Pubkey = pubkey!("G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF");
