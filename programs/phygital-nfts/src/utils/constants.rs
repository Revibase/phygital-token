use anchor_lang::prelude::*;


pub const PROGRAM_AUTHORITY_SEED: &[u8] = b"program_authority";
pub const GROUP_MINT_SEED: &[u8] = b"group_mint";

pub const TRANSFER_HOOK_PROGRAM_ID: Pubkey =
    pubkey!("FCBG7gTThZ9hg4axra4UqWBerBhdjhdBLqxD1jicg84G");

pub const ADMIN:  Pubkey =
    pubkey!("AMn21jT5RMZrv5hSvtkrWCMJFp3cUyeAx4AxKvF59xJZ");


/// On-chain metadata limits — mirror in clients before building transactions.
pub const MAX_METADATA_NAME_LEN: usize = 32;
pub const MAX_METADATA_SYMBOL_LEN: usize = 10;
pub const MAX_METADATA_URI_LEN: usize = 64;
