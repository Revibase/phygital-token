mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_instruction;
use common::{
    assert_token_program_error, assert_transaction_failed, current_slot_entry, TestContext,
    TestPasskey, LAMPORTS_PER_SOL,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_rejects_wrong_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let bad_sig = [0u8; 64];
    let (secp_ix, verify_args) =
        passkey.secp256r1_verify_instruction_with(asset.asset, slot_hash, 1, Some(bad_sig));
    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_transaction_failed(err);
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());
}

#[test]
fn execute_transfer_rejects_passkey_for_different_asset() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let _asset_a = ctx.init_asset(&passkey_a);
    let asset_b = ctx.init_asset(&passkey_b);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    // Sign with passkey A but target asset B (whose public_key is passkey B).
    let (secp_ix, verify_args) =
        passkey_a.secp256r1_verify_instruction(asset_b.asset, slot_hash, 1);
    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset_b.asset, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn execute_transfer_rejects_default_recipient() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(asset.asset, slot_hash, 1);
    let transfer_ix =
        ctx.execute_transfer_ix(Pubkey::default(), asset.asset, verify_args, slot_number);

    let payer = ctx.payer.insecure_clone();
    let err = ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&payer]);
    assert_token_program_error(err, "InvalidRecipient");
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());
}

#[test]
fn execute_transfer_succeeds_when_secp_not_immediately_preceding() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(asset.asset, slot_hash, 1);
    verify_args.verify_args_relative_index = -2;
    let transfer_ix =
        ctx.execute_transfer_ix(recipient.pubkey(), asset.asset, verify_args, slot_number);
    let noop = system_instruction::transfer(&recipient.pubkey(), &recipient.pubkey(), 0);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    ctx.send_execute_transfer_with_instructions(vec![secp_ix, noop, transfer_ix], &[&recipient])
        .expect("transfer should succeed when secp256r1 ix is not immediately preceding");
    assert_eq!(ctx.asset_owner(asset.asset), recipient.pubkey());
}

#[test]
fn execute_transfer_rejects_slot_not_in_sysvar() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let recipient = Keypair::new();
    let missing_slot = 9_999_999;
    let missing_hash = [7u8; 32];

    let err = ctx.send_execute_transfer_at_slot(
        &asset,
        &recipient,
        true,
        Some(missing_slot),
        Some(missing_hash),
        Some(1),
    );
    assert_token_program_error(err, "InvalidSlotHash");
}
