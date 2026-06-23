use anchor_lang::prelude::*;

pub const PROGRAM_AUTHORITY_SEED: &[u8] = b"program_authority";
pub const ASSET_SEED: &[u8] = b"asset";

/// Per-asset delegate PDA `[SPEND_AUTHORITY_SEED, asset.key()]` that owners approve as the SPL
/// delegate on their token account to fund a passkey-gated spending allowance. Kept separate from
/// `PROGRAM_AUTHORITY_SEED` so the NFT authority is never a spend delegate, and scoped per asset so
/// only the approved asset's passkey can draw the budget.
pub const SPEND_AUTHORITY_SEED: &[u8] = b"spend_authority";

pub const TRANSFER_HOOK_PROGRAM_ID: Pubkey =
    pubkey!("2jgBvsDmUW9gEsakLDEvnEFEjG1WwCUzGtNbqbtUr7xR");

pub const ADMIN: Pubkey = pubkey!("EwPqdbs6G64VRvnpHg6sG9SqXLuG9BnyhzCSpZn7e1SP");

/// On-chain metadata limits — mirror in clients before building transactions.
pub const MAX_METADATA_NAME_LEN: usize = 32;
pub const MAX_METADATA_SYMBOL_LEN: usize = 10;
pub const MAX_METADATA_URI_LEN: usize = 200;
