use anchor_lang::prelude::*;

pub const PROGRAM_AUTHORITY_SEED: &[u8] = b"program_authority";
pub const ASSET_SEED: &[u8] = b"asset";

pub const TRANSFER_HOOK_PROGRAM_ID: Pubkey =
    pubkey!("2jgBvsDmUW9gEsakLDEvnEFEjG1WwCUzGtNbqbtUr7xR");

pub const ADMIN: Pubkey = pubkey!("EwPqdbs6G64VRvnpHg6sG9SqXLuG9BnyhzCSpZn7e1SP");

/// On-chain metadata limits — mirror in clients before building transactions.
pub const MAX_METADATA_NAME_LEN: usize = 32;
pub const MAX_METADATA_SYMBOL_LEN: usize = 10;
pub const MAX_METADATA_URI_LEN: usize = 200;
