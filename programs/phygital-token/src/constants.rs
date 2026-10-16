//! PDA seeds and the addresses of the token programs the program recognizes.

use anchor_lang::prelude::*;

/// `PhygitalToken`: `[PHYGITAL_TOKEN_SEED, x(passkey public key)]`.
pub const PHYGITAL_TOKEN_SEED: &[u8] = b"token";
/// `AdminConfig` (singleton): `[ADMIN_CONFIG_SEED]`.
pub const ADMIN_CONFIG_SEED: &[u8] = b"admin";

pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

#[inline]
pub fn is_token_program(program: &Pubkey) -> bool {
    *program == SPL_TOKEN_PROGRAM_ID || *program == TOKEN_2022_PROGRAM_ID
}
