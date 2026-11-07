mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::system_instruction;
use common::{
    assert_phygital_token_program_error, assert_transaction_failed, current_slot_entry,
    TestContext, TestPasskey, LAMPORTS_PER_SOL,
};
use phygital_token::build_set_owner_challenge;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn set_owner_rejects_wrong_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let bad_sig = [0u8; 64];
    let (secp_ix, verify_args) = passkey.secp256r1_instruction_with(
        phygital_token.phygital_token,
        recipient.pubkey(),
        slot_hash,
        Some(bad_sig),
    );
    let transfer_ix = ctx.set_owner_ix(
        recipient.pubkey(),
        phygital_token.phygital_token,
        verify_args,
        slot_number,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, transfer_ix], &[&recipient]);
    assert_transaction_failed(err);
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn set_owner_rejects_passkey_for_different_token() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let _phygital_token_a = ctx.init_phygital_token(&passkey_a);
    let phygital_token_b = ctx.init_phygital_token(&passkey_b);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    // Sign with passkey A but target phygital_token B (whose public_key is passkey B).
    let (secp_ix, verify_args) = passkey_a.secp256r1_instruction(
        phygital_token_b.phygital_token,
        recipient.pubkey(),
        slot_hash,
    );
    let transfer_ix = ctx.set_owner_ix(
        recipient.pubkey(),
        phygital_token_b.phygital_token,
        verify_args,
        slot_number,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, transfer_ix], &[&recipient]);
    assert_phygital_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn set_owner_succeeds_when_secp_not_immediately_preceding() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, mut verify_args) =
        passkey.secp256r1_instruction(phygital_token.phygital_token, recipient.pubkey(), slot_hash);
    verify_args.relative_index = -2;
    let transfer_ix = ctx.set_owner_ix(
        recipient.pubkey(),
        phygital_token.phygital_token,
        verify_args,
        slot_number,
    );
    let noop = system_instruction::transfer(&recipient.pubkey(), &recipient.pubkey(), 0);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    TestContext::send_instructions(&mut ctx.svm, &[secp_ix, noop, transfer_ix], &[&recipient])
        .expect("transfer should succeed when secp256r1 ix is not immediately preceding");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        recipient.pubkey()
    );
}

#[test]
fn set_owner_rejects_slot_not_in_sysvar() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    let missing_slot = 9_999_999;
    let missing_hash = [7u8; 32];

    let err = ctx.send_set_owner_at_slot(
        &phygital_token,
        &recipient,
        true,
        Some(missing_slot),
        Some(missing_hash),
    );
    assert_phygital_token_program_error(err, "InvalidSlotHash");
}

#[test]
fn set_owner_rejects_a_tap_meant_for_another_wallet() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let intended = Keypair::new();
    let attacker = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) =
        passkey.secp256r1_instruction(phygital_token.phygital_token, intended.pubkey(), slot_hash);
    let transfer_ix = ctx.set_owner_ix(
        attacker.pubkey(),
        phygital_token.phygital_token,
        verify_args,
        slot_number,
    );
    ctx.svm
        .airdrop(&attacker.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, transfer_ix], &[&attacker]);
    assert_phygital_token_program_error(err, "ChallengeHashMismatch");
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn set_owner_rejects_a_challenge_without_the_authorize_prefix() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let recipient = Keypair::new();
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let challenge = build_set_owner_challenge(
        &phygital_token.phygital_token,
        &recipient.pubkey(),
        slot_hash,
    );

    // Each validly signed by the token's key: the pre-change `authenticate`
    // prefix, a same-length near miss, and the bare challenge (shorter than
    // any accepted message, so it fails the offsets length check first).
    let cases: [(&[u8], &str); 3] = [
        (b"authenticate", "ChallengeHashMismatch"),
        (b"Authorize", "ChallengeHashMismatch"),
        (b"", "InvalidSignatureOffsets"),
    ];
    for (prefix, expected_error) in cases {
        let message = [prefix, challenge.as_slice()].concat();
        let (secp_ix, verify_args) = passkey.secp256r1_instruction_for_raw_message(&message);
        let transfer_ix = ctx.set_owner_ix(
            recipient.pubkey(),
            phygital_token.phygital_token,
            verify_args,
            slot_number,
        );
        let err =
            TestContext::send_instructions(&mut ctx.svm, &[secp_ix, transfer_ix], &[&recipient]);
        assert_phygital_token_program_error(err, expected_error);
    }
    assert_eq!(
        ctx.phygital_token_owner(phygital_token.phygital_token),
        Pubkey::default()
    );
}
