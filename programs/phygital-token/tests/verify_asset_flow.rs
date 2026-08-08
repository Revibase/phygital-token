mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_token_program_error, current_slot_entry, TestContext, TestPasskey, TEST_ORIGIN,
    TEST_RP_ID,
};
use solana_keypair::Keypair;

const TEST_MESSAGE: &str = "prove you hold this asset";

#[test]
fn verify_asset_succeeds_and_records_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let (slot_number, _) = current_slot_entry(&ctx.svm);

    ctx.send_verify_asset(&asset, TEST_MESSAGE, true, None, None)
        .expect("verify_asset should succeed with valid passkey signature");

    assert_eq!(
        ctx.last_transfer_slot(asset.asset),
        slot_number,
        "asset should record the slot used for verification"
    );
}

#[test]
fn verify_asset_does_not_change_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let owner_before = ctx.asset_owner(asset.asset);

    ctx.send_verify_asset(&asset, TEST_MESSAGE, true, None, None)
        .expect("verify_asset should succeed");

    let owner_after = ctx.asset_owner(asset.asset);
    assert_eq!(owner_before, owner_after);
    assert_eq!(owner_after, Pubkey::default());
}

#[test]
fn verify_asset_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    let err = ctx
        .send_verify_asset(&asset, TEST_MESSAGE, false, None, None)
        .expect_err("verify_asset without secp256r1 ix should fail");

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
fn verify_asset_rejects_mismatched_message() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) =
        passkey.verify_asset_secp256r1_instruction(TEST_MESSAGE, slot_number, slot_hash);
    let verify_ix = ctx.verify_asset_ix(
        asset.asset,
        verify_args,
        "different message".to_string(),
        None,
        None,
    );

    let payer = &ctx.payer;
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, verify_ix], &[payer]);
    assert_token_program_error(err, "ChallengeHashMismatch");
}

#[test]
fn verify_asset_rejects_wrong_passkey() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey_a);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) =
        passkey_b.verify_asset_secp256r1_instruction(TEST_MESSAGE, slot_number, slot_hash);
    let verify_ix = ctx.verify_asset_ix(
        asset.asset,
        verify_args,
        TEST_MESSAGE.to_string(),
        None,
        None,
    );

    let payer = &ctx.payer;
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, verify_ix], &[payer]);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn verify_asset_rejects_slot_not_greater_than_last_verify() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    ctx.send_verify_asset(&asset, TEST_MESSAGE, true, None, None)
        .expect("first verify");

    let err = ctx
        .send_verify_asset(
            &asset,
            "second proof",
            true,
            Some(slot_number),
            Some(slot_hash),
        )
        .expect_err("reusing the same slot after a successful verify should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("StaleTransferSlot") || err_str.contains("6013"),
        "expected stale slot error, got: {err:?}"
    );
}

#[test]
fn verify_asset_allows_next_verify_with_higher_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_verify_asset(&asset, TEST_MESSAGE, true, None, None)
        .expect("first verify");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);
    assert!(second_slot > first_slot);

    ctx.send_verify_asset(
        &asset,
        "second proof",
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("second verify with a higher slot should succeed");

    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
}

#[test]
fn verify_asset_slot_monotonicity_survives_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();

    let (verify_slot, verify_hash) = current_slot_entry(&ctx.svm);
    ctx.send_verify_asset(&asset, TEST_MESSAGE, true, None, None)
        .expect("verify before transfer");

    ctx.set_current_slot(verify_slot.saturating_add(1));
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("transfer after verify");

    let transfer_slot = ctx.last_transfer_slot(asset.asset);
    assert!(transfer_slot > verify_slot);

    let err = ctx
        .send_verify_asset(
            &asset,
            "stale after transfer",
            true,
            Some(verify_slot),
            Some(verify_hash),
        )
        .expect_err("slot from before transfer should be rejected");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("StaleTransferSlot") || err_str.contains("6013"),
        "expected stale slot error, got: {err:?}"
    );
}

#[test]
fn verify_asset_accepts_matching_optional_rp_id_and_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    ctx.send_verify_asset_with_bindings(
        &asset,
        TEST_MESSAGE,
        true,
        None,
        None,
        Some(TEST_RP_ID.to_string()),
        Some(TEST_ORIGIN.to_string()),
    )
    .expect("matching rpId and origin should succeed");
}

#[test]
fn verify_asset_rejects_mismatched_rp_id() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    let err = ctx
        .send_verify_asset_with_bindings(
            &asset,
            TEST_MESSAGE,
            true,
            None,
            None,
            Some("wrong.example".to_string()),
            None,
        )
        .expect_err("mismatched rpId should fail");

    assert_token_program_error(Err(err), "RpIdMismatch");
}

#[test]
fn verify_asset_rejects_mismatched_origin() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    let err = ctx
        .send_verify_asset_with_bindings(
            &asset,
            TEST_MESSAGE,
            true,
            None,
            None,
            None,
            Some("https://app.example".to_string()),
        )
        .expect_err("mismatched origin should fail");

    assert_token_program_error(Err(err), "OriginMismatch");
}

#[test]
fn verify_asset_allows_rp_id_only_or_origin_only() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    ctx.send_verify_asset_with_bindings(
        &asset,
        "rp only",
        true,
        None,
        None,
        Some(TEST_RP_ID.to_string()),
        None,
    )
    .expect("rpId-only check should succeed");

    let (slot, _) = current_slot_entry(&ctx.svm);
    ctx.set_current_slot(slot.saturating_add(1));

    ctx.send_verify_asset_with_bindings(
        &asset,
        "origin only",
        true,
        None,
        None,
        None,
        Some(TEST_ORIGIN.to_string()),
    )
    .expect("origin-only check should succeed");
}
