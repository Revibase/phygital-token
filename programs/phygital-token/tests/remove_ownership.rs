mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_token_program_error, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_token::{PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn remove_ownership_resets_owner_to_default() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim token");
    assert_eq!(ctx.token_owner(token.token), holder.pubkey());

    ctx.send_remove_ownership(&token, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.token_owner(token.token), Pubkey::default());
    assert_eq!(ctx.token_lock_state(token.token), false);
}

#[test]
fn remove_ownership_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim token");
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&token, &attacker);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.token_owner(token.token), holder.pubkey());
}

#[test]
fn remove_ownership_rejects_owner_not_matching_token_record() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let holder = Keypair::new();
    let impostor = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim token");
    ctx.svm
        .airdrop(&impostor.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.remove_ownership_ix(impostor.pubkey(), token.token);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&impostor]);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.token_owner(token.token), holder.pubkey());
}

#[test]
fn remove_ownership_clears_lock_on_lockable_token() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token_of_type(&passkey, PhygitalTokenType::Controlled);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim locked token");
    assert_eq!(ctx.token_lock_state(token.token), true);

    ctx.send_remove_ownership(&token, &holder)
        .expect("remove ownership from locked token");
    assert_eq!(ctx.token_lock_state(token.token), false);
    assert_eq!(ctx.token_owner(token.token), Pubkey::default());
}

#[test]
fn remove_ownership_preserves_last_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim token");
    let count_before = ctx.last_sign_count(token.token);

    ctx.send_remove_ownership(&token, &holder)
        .expect("remove ownership");

    assert_eq!(ctx.last_sign_count(token.token), count_before);
}

#[test]
fn remove_ownership_emits_expected_token_state() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let token = ctx.init_token(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&token, &holder, true)
        .expect("claim token");
    ctx.send_remove_ownership(&token, &holder)
        .expect("remove ownership");

    let instance = ctx.token_account(token.token);
    assert_eq!(instance.owner, Pubkey::default());
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_eq!(instance.is_locked, false);
}
