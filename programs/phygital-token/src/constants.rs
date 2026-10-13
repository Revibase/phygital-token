//! PDA seeds and the addresses of programs and mints the program recognizes.

use anchor_lang::prelude::*;

/// `PhygitalToken`: `[PHYGITAL_TOKEN_SEED, x(passkey public key)]`.
pub const PHYGITAL_TOKEN_SEED: &[u8] = b"token";
/// `AdminConfig` (singleton): `[ADMIN_CONFIG_SEED]`.
pub const ADMIN_CONFIG_SEED: &[u8] = b"admin";

/// The token's wallet: `[WALLET_SEED, phygital_token]`. Holds no data; the
/// program signs for it in `execute_with_owner` / `execute_with_accessory`.
#[constant]
pub const WALLET_SEED: &[u8] = b"wallet";

/// `AccessoryPolicy`: `[POLICY_SEED, phygital_token]`.
#[constant]
pub const POLICY_SEED: &[u8] = b"policy";

pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Wrapped SOL under SPL Token and Token-2022. Spends of these count against
/// the SOL cap, so they cannot have a mint cap of their own.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const WSOL_MINT_2022: Pubkey = pubkey!("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");

#[inline]
pub fn is_wsol_mint(mint: &Pubkey) -> bool {
    *mint == WSOL_MINT || *mint == WSOL_MINT_2022
}
