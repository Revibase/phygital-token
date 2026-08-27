mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_phygital_token_program_error, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_token::{PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn remove_ownership_resets_owner_to_default() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), holder.pubkey());

    ctx.send_remove_ownership(&phygital_token, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), Pubkey::default());
    assert_eq!(ctx.phygital_token_lock_state(phygital_token.phygital_token), false);
}

#[test]
fn remove_ownership_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&phygital_token, &attacker);
    assert_phygital_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), holder.pubkey());
}

#[test]
fn remove_ownership_rejects_owner_not_matching_token_record() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let impostor = Keypair::new();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    ctx.svm
        .airdrop(&impostor.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.remove_ownership_ix(impostor.pubkey(), phygital_token.phygital_token);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&impostor]);
    assert_phygital_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), holder.pubkey());
}

#[test]
fn remove_ownership_clears_lock_on_lockable_token() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim locked phygital_token");
    assert_eq!(ctx.phygital_token_lock_state(phygital_token.phygital_token), true);

    ctx.send_remove_ownership(&phygital_token, &holder)
        .expect("remove ownership from locked phygital_token");
    assert_eq!(ctx.phygital_token_lock_state(phygital_token.phygital_token), false);
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), Pubkey::default());
}

#[test]
fn remove_ownership_preserves_last_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    let count_before = ctx.last_sign_count(phygital_token.phygital_token);

    ctx.send_remove_ownership(&phygital_token, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), count_before);
}

#[test]
fn remove_ownership_emits_expected_token_state() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    ctx.send_remove_ownership(&phygital_token, &holder)
        .expect("remove ownership");

    let instance = ctx.phygital_token_account(phygital_token.phygital_token);
    assert_eq!(instance.owner, Pubkey::default());
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_eq!(instance.is_locked, false);
}
