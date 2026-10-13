use litesvm::types::TransactionResult;

/// Asserts the transaction failed with exactly the given Anchor error (e.g.
/// `"OwnerRequired"`), by matching Anchor's log line
/// `Error Code: <name>. Error Number: <n>.` Matching the whole name (not a
/// substring) keeps `OwnerRequired` from passing on `PermanentOwnerRequired`,
/// and matching by name keeps tests readable without hard-coding numbers.
pub fn assert_phygital_token_program_error(result: TransactionResult, expected_name: &str) {
    let err = result.expect_err("expected transaction to fail");
    let needle = format!("Error Code: {expected_name}. Error Number: ");
    assert!(
        err.meta.logs.iter().any(|line| line.contains(&needle)),
        "expected error {expected_name}, got: {:?}\nlogs: {:#?}",
        err.err,
        err.meta.logs
    );
}

pub fn assert_transaction_failed(result: TransactionResult) {
    result.expect_err("expected transaction to fail");
}
