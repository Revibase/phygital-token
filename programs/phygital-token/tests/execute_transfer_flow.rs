mod common;

use anchor_lang::prelude::Pubkey;
use common::{current_slot_entry, TestContext, TestPasskey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_moves_asset_to_recipient_without_sender_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();

    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());

    let (transfer_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("execute_transfer should succeed with secp256r1 + recipient signature only");

    assert_eq!(
        ctx.last_transfer_slot(asset.asset),
        transfer_slot,
        "asset should record the slot used for the transfer"
    );
    assert_eq!(ctx.asset_owner(asset.asset), recipient.pubkey());
}

#[test]
fn execute_transfer_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();

    let err = ctx
        .send_execute_transfer(&asset, &recipient, false)
        .expect_err("execute_transfer without secp256r1 ix should fail");

    // With no preceding secp256r1 instruction, the asset constraint fails while
    // trying to read it, surfacing as a generic InvalidArgument.
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidArgument") || err_str.contains("InvalidSecp256r1Instruction"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());
}

#[test]
fn execute_transfer_rejects_slot_not_greater_than_last_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer(&asset, &first_recipient, true)
        .expect("first transfer");
    assert_eq!(ctx.last_transfer_slot(asset.asset), slot_number);

    let err = ctx
        .send_execute_transfer_at_slot(
            &asset,
            &second_recipient,
            true,
            Some(slot_number),
            Some(slot_hash),
        )
        .expect_err("reusing the same slot after a successful transfer should fail");

    assert!(
        format!("{err:?}").contains("StaleTransferSlot"),
        "expected stale slot error, got: {err:?}"
    );
    assert_eq!(ctx.asset_owner(asset.asset), first_recipient.pubkey());
}

#[test]
fn execute_transfer_allows_next_transfer_with_higher_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &first_recipient, true)
        .expect("first transfer");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);
    assert!(second_slot > first_slot);

    ctx.send_execute_transfer_at_slot(
        &asset,
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("second transfer with a higher slot should succeed");

    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
    assert_eq!(ctx.asset_owner(asset.asset), second_recipient.pubkey());
}
