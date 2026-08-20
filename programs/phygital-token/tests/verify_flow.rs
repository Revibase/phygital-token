mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_token_program_error, TestContext, TestPasskey, TEST_ORIGIN, TEST_RP_ID};
use solana_keypair::Keypair;

const TEST_MESSAGE_HASH: [u8; 32] = [1u8; 32];
const SECOND_MESSAGE_HASH: [u8; 32] = [2u8; 32];
const RP_ONLY_MESSAGE_HASH: [u8; 32] = [3u8; 32];
const ORIGIN_ONLY_MESSAGE_HASH: [u8; 32] = [4u8; 32];
const STALE_MESSAGE_HASH: [u8; 32] = [5u8; 32];

#[test]
fn verify_succeeds_and_records_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    ctx.send_verify(&token, TEST_MESSAGE_HASH, true)
        .expect("verify should succeed with valid passkey signature");

    assert_eq!(
        ctx.last_sign_count(token.token),
        1,
        "token should record the WebAuthn signCount used for verification"
    );
}

#[test]
fn verify_does_not_change_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let owner_before = ctx.token_owner(token.token);

    ctx.send_verify(&token, TEST_MESSAGE_HASH, true)
        .expect("verify should succeed");

    let owner_after = ctx.token_owner(token.token);
    assert_eq!(owner_before, owner_after);
    assert_eq!(owner_after, Pubkey::default());
}

#[test]
fn verify_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    let err = ctx
        .send_verify(&token, TEST_MESSAGE_HASH, false)
        .expect_err("verify without secp256r1 ix should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidSecp256r1Instruction")
            || err_str.contains("6002")
            || err_str.contains("MissingSecp256r1Instruction")
            || err_str.contains("InvalidArgument")
            || err_str.contains("ClientDataHashMismatch"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn verify_rejects_mismatched_message() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    let (secp_ix, verify_args) = passkey.verify_secp256r1_instruction(TEST_MESSAGE_HASH, 1);
    let verify_ix = ctx.verify_ix(token.token, verify_args, SECOND_MESSAGE_HASH, None, None);

    let payer = &ctx.payer;
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, verify_ix], &[payer]);
    assert_token_program_error(err, "ChallengeHashMismatch");
}

#[test]
fn verify_rejects_wrong_passkey() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let token = ctx.init_token(&passkey_a);

    let (secp_ix, verify_args) = passkey_b.verify_secp256r1_instruction(TEST_MESSAGE_HASH, 1);
    let verify_ix = ctx.verify_ix(token.token, verify_args, TEST_MESSAGE_HASH, None, None);

    let payer = &ctx.payer;
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, verify_ix], &[payer]);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn verify_rejects_sign_count_not_greater_than_last() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    ctx.send_verify(&token, TEST_MESSAGE_HASH, true)
        .expect("first verify");

    let err = ctx
        .send_verify_with_bindings(&token, SECOND_MESSAGE_HASH, true, Some(1), None, None)
        .expect_err("reusing the same signCount after a successful verify should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("StaleSignCount") || err_str.contains("6013"),
        "expected stale signCount error, got: {err:?}"
    );
}

#[test]
fn verify_allows_next_verify_with_higher_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    ctx.send_verify(&token, TEST_MESSAGE_HASH, true)
        .expect("first verify");

    ctx.send_verify_with_bindings(&token, SECOND_MESSAGE_HASH, true, Some(2), None, None)
        .expect("second verify with a higher signCount should succeed");

    assert_eq!(ctx.last_sign_count(token.token), 2);
}

#[test]
fn verify_sign_count_monotonicity_survives_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let recipient = Keypair::new();

    ctx.send_verify(&token, TEST_MESSAGE_HASH, true)
        .expect("verify before transfer");
    assert_eq!(ctx.last_sign_count(token.token), 1);

    ctx.send_transfer_ownership(&token, &recipient, true)
        .expect("transfer after verify");
    assert_eq!(ctx.last_sign_count(token.token), 2);

    let err = ctx
        .send_verify_with_bindings(&token, STALE_MESSAGE_HASH, true, Some(1), None, None)
        .expect_err("signCount from before transfer should be rejected");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("StaleSignCount") || err_str.contains("6013"),
        "expected stale signCount error, got: {err:?}"
    );
}

#[test]
fn verify_accepts_matching_optional_rp_id_and_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    ctx.send_verify_with_bindings(
        &token,
        TEST_MESSAGE_HASH,
        true,
        None,
        Some(TEST_RP_ID.to_string()),
        Some(TEST_ORIGIN.to_string()),
    )
    .expect("matching rpId and origin should succeed");
}

#[test]
fn verify_rejects_mismatched_rp_id() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    let err = ctx
        .send_verify_with_bindings(
            &token,
            TEST_MESSAGE_HASH,
            true,
            None,
            Some("wrong.example".to_string()),
            None,
        )
        .expect_err("mismatched rpId should fail");

    assert_token_program_error(Err(err), "RpIdMismatch");
}

#[test]
fn verify_rejects_mismatched_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    let err = ctx
        .send_verify_with_bindings(
            &token,
            TEST_MESSAGE_HASH,
            true,
            None,
            None,
            Some("https://app.example".to_string()),
        )
        .expect_err("mismatched origin should fail");

    assert_token_program_error(Err(err), "OriginMismatch");
}

#[test]
fn verify_allows_rp_id_only_or_origin_only() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);

    ctx.send_verify_with_bindings(
        &token,
        RP_ONLY_MESSAGE_HASH,
        true,
        None,
        Some(TEST_RP_ID.to_string()),
        None,
    )
    .expect("rpId-only check should succeed");

    ctx.send_verify_with_bindings(
        &token,
        ORIGIN_ONLY_MESSAGE_HASH,
        true,
        Some(2),
        None,
        Some(TEST_ORIGIN.to_string()),
    )
    .expect("origin-only check should succeed");
}
