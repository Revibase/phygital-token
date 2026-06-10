use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use phygital_nfts::constants::{
    MAX_METADATA_NAME_LEN, MAX_METADATA_SYMBOL_LEN, MAX_METADATA_URI_LEN,
};
use phygital_nfts::Secp256r1Pubkey;
use phygital_nfts::utils::{
    encode_last_transfer_slot, encode_secp256r1_pubkey, initial_last_transfer_slot_value,
    validate_metadata_strings, LAST_TRANSFER_SLOT_NONE, LAST_TRANSFER_SLOT_WIDTH,
};

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
fn last_transfer_slot_metadata_uses_fixed_width_encoding() {
    assert_eq!(initial_last_transfer_slot_value().len(), LAST_TRANSFER_SLOT_WIDTH);
    assert_eq!(
        initial_last_transfer_slot_value(),
        encode_last_transfer_slot(LAST_TRANSFER_SLOT_NONE)
    );
    assert_eq!(encode_last_transfer_slot(42), "00000000000000000042");
    assert_eq!(
        encode_last_transfer_slot(u64::MAX).len(),
        LAST_TRANSFER_SLOT_WIDTH
    );
}

#[test]
fn encode_secp256r1_pubkey_base64() {
    let pubkey = Secp256r1Pubkey([0x02u8; 33]);
    let encoded = encode_secp256r1_pubkey(&pubkey);
    let decoded: Vec<u8> = BASE64.decode(encoded).expect("valid base64");
    assert_eq!(decoded.as_slice(), pubkey.as_ref());
}
