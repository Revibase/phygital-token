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
fn transfer_ownership_rejects_wrong_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let bad_sig = [0u8; 64];
    let (secp_ix, verify_args) =
        passkey.secp256r1_verify_instruction_with(token.token, slot_hash, 1, Some(bad_sig));
    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), token.token, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_transaction_failed(err);
    assert_eq!(ctx.token_owner(token.token), Pubkey::default());
}

#[test]
fn transfer_ownership_rejects_passkey_for_different_token() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let _token_a = ctx.init_token(&passkey_a);
    let token_b = ctx.init_token(&passkey_b);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    // Sign with passkey A but target token B (whose public_key is passkey B).
    let (secp_ix, verify_args) =
        passkey_a.secp256r1_verify_instruction(token_b.token, slot_hash, 1);
    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), token_b.token, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn transfer_ownership_succeeds_when_secp_not_immediately_preceding() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(token.token, slot_hash, 1);
    verify_args.verify_args_relative_index = -2;
    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), token.token, verify_args, slot_number);
    let noop = system_instruction::transfer(&recipient.pubkey(), &recipient.pubkey(), 0);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    ctx.send_transfer_ownership_with_instructions(vec![secp_ix, noop, transfer_ix], &[&recipient])
        .expect("transfer should succeed when secp256r1 ix is not immediately preceding");
    assert_eq!(ctx.token_owner(token.token), recipient.pubkey());
}

#[test]
fn transfer_ownership_rejects_slot_not_in_sysvar() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let recipient = Keypair::new();
    let missing_slot = 9_999_999;
    let missing_hash = [7u8; 32];

    let err = ctx.send_transfer_ownership_at_slot(
        &token,
        &recipient,
        true,
        Some(missing_slot),
        Some(missing_hash),
        Some(1),
    );
    assert_token_program_error(err, "InvalidSlotHash");
}
