use anchor_lang::prelude::Rent;
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::state::Account as SplTokenAccount;
use phygital_token::constants::{
    MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN, MAX_METADATA_URI_LEN,
};
use phygital_token::state::LAST_TRANSFER_SLOT_NONE;
use phygital_token::utils::{mint_metadata_tlv_size, validate_metadata_strings};

#[test]
fn mint_token_account_rent_matches_transfer_hook_ata() {
    let len = ExtensionType::try_calculate_account_len::<SplTokenAccount>(&[
        ExtensionType::ImmutableOwner,
        ExtensionType::TransferHookAccount,
    ])
    .expect("len");
    let rent = Rent::default().minimum_balance(len);
    assert_eq!(len, 175);
    assert_eq!(rent, 2_108_880);
}

#[test]
fn validate_metadata_strings_accepts_limits() {
    let name = "n".repeat(MAX_METADATA_NAME_LEN);
    let symbol = "s".repeat(MAX_METADATA_SYMBOL_LEN);
    let uri = "u".repeat(MAX_METADATA_URI_LEN);
    validate_metadata_strings(&name, &symbol, &uri).expect("at-limit strings should pass");
}

#[test]
fn validate_metadata_strings_rejects_long_uri() {
    let uri = "u".repeat(MAX_METADATA_URI_LEN + 1);
    let err = validate_metadata_strings("nft", "NFT", &uri).expect_err("over-limit uri");
    assert!(format!("{err:?}").contains("MaxLengthExceeded"));
}

#[test]
fn mint_metadata_tlv_size_is_positive() {
    let size = mint_metadata_tlv_size("Test Design", "TDES", "https://example.com/x.json")
        .expect("tlv size");
    assert!(size > 0);
    assert_eq!(LAST_TRANSFER_SLOT_NONE, u64::MAX);
}

#[test]
fn validate_metadata_strings_rejects_long_name() {
    let name = "n".repeat(MAX_METADATA_NAME_LEN + 1);
    let err = validate_metadata_strings(&name, "NFT", "https://example.com/x.json")
        .expect_err("over-limit name");
    assert!(format!("{err:?}").contains("MaxLengthExceeded"));
}

#[test]
fn validate_metadata_strings_rejects_long_symbol() {
    let symbol = "s".repeat(MAX_METADATA_SYMBOL_LEN + 1);
    let err = validate_metadata_strings("nft", &symbol, "https://example.com/x.json")
        .expect_err("over-limit symbol");
    assert!(format!("{err:?}").contains("MaxLengthExceeded"));
}
