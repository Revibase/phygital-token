mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_phygital_token_program_error, assert_transaction_failed, current_slot_entry, TestContext,
    TestPasskey, LAMPORTS_PER_SOL,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// `signed_message_index` past the number of signatures in the secp256r1
/// instruction must be rejected (covers `SignatureIndexOutOfBounds`).
#[test]
fn transfer_ownership_rejects_signature_index_out_of_bounds() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(phygital_token.phygital_token, slot_hash, 1);
    verify_args.signed_message_index = 1;

    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), phygital_token.phygital_token, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_phygital_token_program_error(err, "SignatureIndexOutOfBounds");
}

/// Malformed `client_data_json` must be rejected before hash comparison.
#[test]
fn transfer_ownership_rejects_unparseable_client_data() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(phygital_token.phygital_token, slot_hash, 1);
    verify_args.client_data_json = b"not-json".to_vec();

    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), phygital_token.phygital_token, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_phygital_token_program_error(err, "UnableToParseClientData");
}

/// `client_data_json` must hash to the value embedded in the secp256r1 instruction.
#[test]
fn transfer_ownership_rejects_client_data_hash_mismatch() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_verify_instruction(phygital_token.phygital_token, slot_hash, 1);
    verify_args.client_data_json.push(b' ');

    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), phygital_token.phygital_token, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_phygital_token_program_error(err, "ClientDataHashMismatch");
}

/// Authenticator data without the WebAuthn UP flag must be rejected.
#[test]
fn transfer_ownership_rejects_missing_user_presence() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) =
        passkey.secp256r1_verify_instruction_with_auth_flags(phygital_token.phygital_token, slot_hash, 1, 0x00);

    let transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), phygital_token.phygital_token, verify_args, slot_number);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_phygital_token_program_error(err, "UserPresenceNotVerified");
}

/// The passkey signs over the phygital_token PDA only — recipient is not in the challenge —
/// but the recipient wallet must co-sign to accept ownership.
#[test]
fn transfer_ownership_rejects_recipient_not_signing() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(phygital_token.phygital_token, slot_hash, 1);

    let mut transfer_ix =
        ctx.transfer_ownership_ix(recipient.pubkey(), phygital_token.phygital_token, verify_args, slot_number);
    for meta in &mut transfer_ix.accounts {
        if meta.pubkey == recipient.pubkey() {
            meta.is_signer = false;
        }
    }

    let payer = ctx.payer.insecure_clone();
    let err =
        ctx.send_transfer_ownership_with_instructions(vec![secp_ix, transfer_ix], &[&payer]);
    assert_transaction_failed(err);
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), Pubkey::default());
}
