use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use spl_token_group_interface::state::{TokenGroup, TokenGroupMember};
use spl_token_metadata_interface::state::TokenMetadata;

use crate::constants::{MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN, MAX_METADATA_URI_LEN};
use crate::error::TokenProgramError;
use crate::Secp256r1Pubkey;

pub const SECP256R1_METADATA_KEY: &str = "s";
pub const DOMAIN_CONFIG_METADATA_KEY: &str = "dc";
pub const ROYALTY_OWNER_METADATA_KEY: &str = "ro";
pub const ROYALTY_BPS_METADATA_KEY: &str = "rb";
pub const TRANSFER_PRICE_METADATA_KEY: &str = "p";
pub const PAYMENT_TOKEN_MINT_METADATA_KEY: &str = "m";
pub const ALLOWED_RECIPIENT_METADATA_KEY: &str = "a";
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

fn parse_optional_pubkey(value: &str) -> Result<Option<Pubkey>> {
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(
            value
                .parse::<Pubkey>()
                .map_err(|_| error!(TokenProgramError::InvalidMetadata))?,
        ))
    }
}

pub fn encode_optional_pubkey(value: Option<Pubkey>) -> String {
    value.map(|key| key.to_string()).unwrap_or_default()
}

pub fn encode_secp256r1_pubkey(pubkey: &Secp256r1Pubkey) -> String {
    BASE64.encode(pubkey.0)
}

/// Placeholder transfer-config fields written during `create_token`.
/// `set_transfer_config` overwrites these without growing the mint account.
pub fn transfer_config_placeholder_fields() -> [(&'static str, &'static str); 3] {
    [
        (TRANSFER_PRICE_METADATA_KEY, "0"),
        (PAYMENT_TOKEN_MINT_METADATA_KEY, ""),
        (ALLOWED_RECIPIENT_METADATA_KEY, ""),
    ]
}

fn upsert_additional_metadata(metadata: &mut TokenMetadata, key: &str, value: String) {
    if let Some((_, existing)) = metadata
        .additional_metadata
        .iter_mut()
        .find(|(field_key, _)| field_key == key)
    {
        *existing = value;
    } else {
        metadata.additional_metadata.push((key.to_string(), value));
    }
}

/// TLV size for a member mint at `create_token` — placeholders only.
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
    for (key, value) in transfer_config_placeholder_fields() {
        metadata
            .additional_metadata
            .push((key.to_string(), value.to_string()));
    }
    metadata.additional_metadata.push((
        LAST_TRANSFER_SLOT_METADATA_KEY.to_string(),
        initial_last_transfer_slot_value(),
    ));
    metadata
        .tlv_size_of()
        .map_err(|_| error!(TokenProgramError::ArithmeticOverflow))
}

pub fn token_metadata_with_transfer_config(
    metadata: &TokenMetadata,
    price: u64,
    payment_token_mint: Option<Pubkey>,
    allowed_recipient: Option<Pubkey>,
) -> TokenMetadata {
    let mut updated = metadata.clone();
    upsert_additional_metadata(&mut updated, TRANSFER_PRICE_METADATA_KEY, price.to_string());
    upsert_additional_metadata(
        &mut updated,
        PAYMENT_TOKEN_MINT_METADATA_KEY,
        encode_optional_pubkey(payment_token_mint),
    );
    upsert_additional_metadata(
        &mut updated,
        ALLOWED_RECIPIENT_METADATA_KEY,
        encode_optional_pubkey(allowed_recipient),
    );
    updated
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

pub fn get_domain_config(mint: &AccountInfo) -> Result<Pubkey> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field(&metadata, DOMAIN_CONFIG_METADATA_KEY)?;
    value
        .parse::<Pubkey>()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

/// Ensures `group_mint` was created via `create_group_token`.
pub fn validate_collection_group_mint(
    group_mint: &AccountInfo,
    program_authority: Pubkey,
) -> Result<()> {
    get_domain_config(group_mint)?;

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

pub fn get_royalty_owner(mint: &AccountInfo) -> Result<Pubkey> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field(&metadata, ROYALTY_OWNER_METADATA_KEY)
        .or_else(|_| get_metadata_field(&metadata, "royalty_owner"))?;
    value
        .parse::<Pubkey>()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

pub fn get_royalty_bps(mint: &AccountInfo) -> Result<u16> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field(&metadata, ROYALTY_BPS_METADATA_KEY)
        .or_else(|_| get_metadata_field(&metadata, "royalty_bps"))?;
    let royalty_bps: u16 = value
        .parse()
        .map_err(|_| error!(TokenProgramError::InvalidRoyaltyBps))?;
    require!(royalty_bps <= 10_000, TokenProgramError::InvalidRoyaltyBps);
    Ok(royalty_bps)
}

pub fn get_transfer_price(mint: &AccountInfo) -> Result<u64> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field_optional(&metadata, TRANSFER_PRICE_METADATA_KEY);
    if value.is_empty() {
        let legacy = get_metadata_field_optional(&metadata, "transfer_price");
        if legacy.is_empty() {
            return Ok(0);
        }
        return legacy
            .parse()
            .map_err(|_| error!(TokenProgramError::InvalidMetadata));
    }
    value
        .parse()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

pub fn get_payment_token_mint(mint: &AccountInfo) -> Result<Option<Pubkey>> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field_optional(&metadata, PAYMENT_TOKEN_MINT_METADATA_KEY);
    if value.is_empty() {
        return parse_optional_pubkey(&get_metadata_field_optional(
            &metadata,
            "payment_token_mint",
        ));
    }
    parse_optional_pubkey(&value)
}

pub fn get_last_transfer_slot(mint: &AccountInfo) -> Result<u64> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field_optional(&metadata, LAST_TRANSFER_SLOT_METADATA_KEY);
    if value.is_empty() {
        return Ok(0);
    }
    value
        .parse()
        .map_err(|_| error!(TokenProgramError::InvalidMetadata))
}

pub fn get_allowed_recipient(mint: &AccountInfo) -> Result<Option<Pubkey>> {
    let metadata = get_token_metadata(mint)?;
    let value = get_metadata_field_optional(&metadata, ALLOWED_RECIPIENT_METADATA_KEY);
    if value.is_empty() {
        return parse_optional_pubkey(&get_metadata_field_optional(&metadata, "allowed_recipient"));
    }
    parse_optional_pubkey(&value)
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
