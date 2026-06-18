use anchor_lang::prelude::*;
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;

use crate::constants::{MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN, MAX_METADATA_URI_LEN};
use crate::error::PhygitalError;

pub fn validate_metadata_strings(name: &str, symbol: &str, uri: &str) -> Result<()> {
    require!(
        name.len() <= MAX_METADATA_NAME_LEN,
        PhygitalError::MaxLengthExceeded
    );
    require!(
        symbol.len() <= MAX_METADATA_SYMBOL_LEN,
        PhygitalError::MaxLengthExceeded
    );
    require!(
        uri.len() <= MAX_METADATA_URI_LEN,
        PhygitalError::MaxLengthExceeded
    );
    Ok(())
}

pub fn mint_metadata_tlv_size(name: &str, symbol: &str, uri: &str) -> Result<usize> {
    let metadata = TokenMetadata {
        name: name.to_string(),
        symbol: symbol.to_string(),
        uri: uri.to_string(),
        ..Default::default()
    };
    metadata
        .tlv_size_of()
        .map_err(|_| error!(PhygitalError::ArithmeticOverflow))
}
