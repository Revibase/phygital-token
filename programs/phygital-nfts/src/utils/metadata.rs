use anchor_lang::prelude::*;
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;

use crate::constants::{
    CARD_INSTANCE_SEED, MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN, MAX_METADATA_URI_LEN,
};
use crate::error::TokenProgramError;
use crate::Secp256r1Pubkey;

pub const LAST_TRANSFER_SLOT_NONE: u64 = u64::MAX;

pub fn validate_uri(uri: &str) -> Result<()> {
    require!(
        uri.len() <= MAX_METADATA_URI_LEN,
        TokenProgramError::MaxLengthExceeded
    );
    Ok(())
}

pub fn validate_metadata_strings(name: &str, symbol: &str, uri: &str) -> Result<()> {
    require!(
        name.len() <= MAX_METADATA_NAME_LEN,
        TokenProgramError::MaxLengthExceeded
    );
    require!(
        symbol.len() <= MAX_METADATA_SYMBOL_LEN,
        TokenProgramError::MaxLengthExceeded
    );
    require!(
        uri.len() <= MAX_METADATA_URI_LEN,
        TokenProgramError::MaxLengthExceeded
    );
    Ok(())
}

/// TLV size for a design mint at `create_design_mint`.
pub fn design_mint_metadata_tlv_size(name: &str, symbol: &str, uri: &str) -> Result<usize> {
    let metadata = TokenMetadata {
        name: name.to_string(),
        symbol: symbol.to_string(),
        uri: uri.to_string(),
        ..Default::default()
    };
    metadata
        .tlv_size_of()
        .map_err(|_| error!(TokenProgramError::ArithmeticOverflow))
}

pub fn find_card_instance_pda(secp256r1_pubkey: &Secp256r1Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CARD_INSTANCE_SEED, crate::utils::secp256r1_pda_seed(secp256r1_pubkey)],
        program_id,
    )
}
