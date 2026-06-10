use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use spl_token_group_interface::state::{TokenGroup, TokenGroupMember};
use spl_token_metadata_interface::state::TokenMetadata;

use crate::constants::{
    GROUP_MINT_SEED, MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN, MAX_METADATA_URI_LEN,
};
use crate::error::TokenProgramError;
use crate::Secp256r1Pubkey;

pub const SECP256R1_METADATA_KEY: &str = "s";
pub const GROUP_UNIQUE_ID_METADATA_KEY: &str = "ui";
pub const LAST_TRANSFER_SLOT_METADATA_KEY: &str = "ls";
pub const LAST_TRANSFER_SLOT_WIDTH: usize = 20;
pub const LAST_TRANSFER_SLOT_NONE: u64 = u64::MAX;

pub fn initial_last_transfer_slot_value() -> String {
    encode_last_transfer_slot(LAST_TRANSFER_SLOT_NONE)
}

pub fn encode_last_transfer_slot(slot: u64) -> String {
    format!("{:0width$}", slot, width = LAST_TRANSFER_SLOT_WIDTH)
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

fn get_token_metadata(mint: &AccountInfo) -> Result<TokenMetadata> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))?;
    state
        .get_variable_len_extension::<TokenMetadata>()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

fn get_metadata_field(metadata: &TokenMetadata, key: &str) -> Result<String> {
    metadata
        .additional_metadata
        .iter()
        .find(|(field_key, _)| field_key == key)
        .map(|(_, value)| value.clone())
        .ok_or(error!(TokenProgramError::InvalidMetadata))
}

fn get_metadata_field_optional(metadata: &TokenMetadata, key: &str) -> String {
    metadata
        .additional_metadata
        .iter()
        .find(|(field_key, _)| field_key == key)
        .map(|(_, value)| value.clone())
        .unwrap_or_default()
}

pub fn encode_secp256r1_pubkey(pubkey: &Secp256r1Pubkey) -> String {
    BASE64.encode(pubkey.0)
}

/// TLV size for a member mint at `create_token`.
pub fn member_mint_metadata_tlv_size(
    name: &str,
    symbol: &str,
    uri: &str,
    secp256r1_value: &str,
) -> Result<usize> {
    let mut metadata = TokenMetadata {
        name: name.to_string(),
        symbol: symbol.to_string(),
        uri: uri.to_string(),
        ..Default::default()
    };
    metadata.additional_metadata.push((
        SECP256R1_METADATA_KEY.to_string(),
        secp256r1_value.to_string(),
    ));
    metadata.additional_metadata.push((
        LAST_TRANSFER_SLOT_METADATA_KEY.to_string(),
        initial_last_transfer_slot_value(),
    ));
    metadata
        .tlv_size_of()
        .map_err(|_| error!(TokenProgramError::ArithmeticOverflow))
}

pub fn get_group_mint(mint: &AccountInfo) -> Result<Pubkey> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(TokenProgramError::GroupMintMismatch))?;
    let member = state
        .get_extension::<TokenGroupMember>()
        .map_err(|_| error!(TokenProgramError::GroupMintMismatch))?;
    Ok(member.group.into())
}

pub fn get_secp256r1_pubkey(mint: &AccountInfo) -> Result<[u8; 33]> {
    let metadata = get_token_metadata(mint)?;
    if let Ok(encoded) = get_metadata_field(&metadata, SECP256R1_METADATA_KEY) {
        return decode_secp256r1_base64(&encoded);
    }
    let hex_str = get_metadata_field(&metadata, "secp256r1_pubkey")?;
    decode_secp256r1_hex(&hex_str)
}

pub fn find_group_mint_pda(unique_id: u64, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[GROUP_MINT_SEED, &unique_id.to_le_bytes()],
        program_id,
    )
}

pub fn get_group_unique_id(mint: &AccountInfo) -> Result<u64> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field(&metadata, GROUP_UNIQUE_ID_METADATA_KEY)?;
    value
        .parse::<u64>()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

/// Ensures `group_mint` was created via `create_group_token`.
pub fn validate_collection_group_mint(
    group_mint: &AccountInfo,
    program_authority: Pubkey,
    program_id: &Pubkey,
) -> Result<()> {
    let unique_id = get_group_unique_id(group_mint)?;
    let (expected_pda, _) = find_group_mint_pda(unique_id, program_id);
    require!(
        group_mint.key() == expected_pda,
        TokenProgramError::GroupMintMismatch
    );

    let data = group_mint.try_borrow_data()?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(TokenProgramError::GroupMintMismatch))?;
    let group = state
        .get_extension::<TokenGroup>()
        .map_err(|_| error!(TokenProgramError::GroupMintMismatch))?;

    let update_authority = group
        .update_authority
        .get()
        .ok_or(error!(TokenProgramError::GroupMintMismatch))?;
    require!(
        Pubkey::from(update_authority) == program_authority,
        TokenProgramError::GroupMintMismatch
    );

    Ok(())
}

pub fn get_last_transfer_slot(mint: &AccountInfo) -> Result<u64> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field_optional(&metadata, LAST_TRANSFER_SLOT_METADATA_KEY);
    if value.is_empty() {
        return Ok(LAST_TRANSFER_SLOT_NONE);
    }
    value
        .parse()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

fn decode_secp256r1_base64(encoded: &str) -> Result<[u8; 33]> {
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| error!(TokenProgramError::InvalidSecp256r1Signature))?;
    require!(
        bytes.len() == 33,
        TokenProgramError::InvalidSecp256r1Signature
    );
    Ok(bytes.try_into().unwrap())
}

fn decode_secp256r1_hex(hex_str: &str) -> Result<[u8; 33]> {
    require!(
        hex_str.len() == 66,
        TokenProgramError::InvalidSecp256r1Signature
    );

    let mut out = [0u8; 33];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex_str[i * 2..i * 2 + 2], 16)
            .map_err(|_| error!(TokenProgramError::InvalidSecp256r1Signature))?;
    }

    Ok(out)
}
