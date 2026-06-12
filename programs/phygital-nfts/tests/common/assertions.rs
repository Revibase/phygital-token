use litesvm::types::TransactionResult;

/// Anchor custom error codes from [`phygital_nfts::error::TokenProgramError`].
pub mod error_code {
    pub const INVALID_SECP256R1_SIGNATURE: u32 = 6000;
    pub const INVALID_SECP256R1_INSTRUCTION: u32 = 6002;
    pub const SECP256R1_PUBKEY_MISMATCH: u32 = 6007;
    pub const INVALID_METADATA: u32 = 6008;
    pub const INVALID_PARENT_GROUP: u32 = 6009;
    pub const DESIGN_MINT_MISMATCH: u32 = 6010;
    pub const OWNER_MISMATCH: u32 = 6012;
    pub const INVALID_TRANSFER_HOOK_PROGRAM: u32 = 6018;
    pub const INVALID_SLOT_HASH: u32 = 6019;
    pub const STALE_TRANSFER_SLOT: u32 = 6020;
    pub const INVALID_TRANSFER_AUTHORITY: u32 = 6021;
    pub const CLIENT_DATA_HASH_MISMATCH: u32 = 6023;
    pub const MAX_LENGTH_EXCEEDED: u32 = 6026;
    pub const AUTHORITY_MISMATCH: u32 = 6027;
    pub const INVALID_PAYMENT_TOKEN_ACCOUNT: u32 = 6028;
}

pub fn assert_token_program_error(result: TransactionResult, expected_name: &str, expected_code: u32) {
    let err = result.expect_err("expected transaction to fail");
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains(expected_name) || err_str.contains(&expected_code.to_string()),
        "expected {expected_name} ({expected_code}), got: {err:?}"
    );
}

pub fn assert_transaction_failed(result: TransactionResult) {
    result.expect_err("expected transaction to fail");
}
