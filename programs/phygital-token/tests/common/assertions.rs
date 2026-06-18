use litesvm::types::TransactionResult;

/// Asserts the transaction failed with the given Anchor error variant name
/// (e.g. `"MintMismatch"`). Matches on the variant name rather than the numeric
/// code so the assertion does not drift when error variants are added or removed.
pub fn assert_token_program_error(result: TransactionResult, expected_name: &str) {
    let err = result.expect_err("expected transaction to fail");
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains(expected_name),
        "expected error {expected_name}, got: {err:?}"
    );
}

pub fn assert_transaction_failed(result: TransactionResult) {
    result.expect_err("expected transaction to fail");
}
