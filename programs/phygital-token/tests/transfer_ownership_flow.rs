mod common;

use anchor_lang::prelude::Pubkey;
use common::{current_slot_entry, TestContext, TestPasskey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_ownership_moves_token_to_recipient_with_recipient_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();

    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), Pubkey::default());

    let meta = ctx
        .send_transfer_ownership(&phygital_token, &recipient, true)
        .expect("transfer_ownership should succeed with secp256r1 + recipient signature only");
    eprintln!(
        "CU transfer_ownership_moves_token_to_recipient: {}",
        meta.compute_units_consumed
    );

    assert_eq!(
        ctx.last_sign_count(phygital_token.phygital_token),
        1,
        "phygital_token should record the WebAuthn signCount used for the transfer"
    );
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), recipient.pubkey());
}

#[test]
fn transfer_ownership_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();

    let err = ctx
        .send_transfer_ownership(&phygital_token, &recipient, false)
        .expect_err("transfer_ownership without secp256r1 ix should fail");

    // With no preceding secp256r1 instruction, the phygital_token constraint fails while
    // trying to read it, surfacing as a generic InvalidArgument.
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidArgument") || err_str.contains("InvalidSecp256r1Instruction"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), Pubkey::default());
}

#[test]
fn transfer_ownership_rejects_sign_count_not_greater_than_last() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    ctx.send_transfer_ownership(&phygital_token, &first_recipient, true)
        .expect("first transfer");
    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 1);

    let err = ctx
        .send_transfer_ownership_at_slot(
            &phygital_token,
            &second_recipient,
            true,
            Some(slot_number),
            Some(slot_hash),
            Some(1),
        )
        .expect_err("reusing the same signCount after a successful transfer should fail");

    assert!(
        format!("{err:?}").contains("StaleSignCount"),
        "expected stale signCount error, got: {err:?}"
    );
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), first_recipient.pubkey());
}

#[test]
fn transfer_ownership_allows_next_transfer_with_higher_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&phygital_token, &first_recipient, true)
        .expect("first transfer");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);
    assert!(second_slot > first_slot);

    ctx.send_transfer_ownership_at_slot(
        &phygital_token,
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
        None,
    )
    .expect("second transfer with a higher signCount should succeed");

    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), 2);
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), second_recipient.pubkey());
}
