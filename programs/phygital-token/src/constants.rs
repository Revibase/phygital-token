use anchor_lang::prelude::*;

pub const PHYGITAL_TOKEN_SEED: &[u8] = b"token";
pub const ADMIN_CONFIG_SEED: &[u8] = b"admin";

#[constant]
pub const WALLET_SEED: &[u8] = b"wallet";

#[constant]
pub const POLICY_SEED: &[u8] = b"policy";

pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const WSOL_MINT_2022: Pubkey = pubkey!("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");

#[inline]
pub fn is_wsol_mint(mint: &Pubkey) -> bool {
    *mint == WSOL_MINT || *mint == WSOL_MINT_2022
}
