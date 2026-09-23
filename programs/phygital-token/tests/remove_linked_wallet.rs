mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_phygital_token_program_error, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_token::{PhygitalTokenType, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn remove_linked_wallet_resets_linked_wallet_to_default() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();

    ctx.send_set_linked_wallet(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    assert_eq!(
        ctx.phygital_token_linked_wallet(phygital_token.phygital_token),
        holder.pubkey()
    );

    ctx.send_remove_linked_wallet(&phygital_token, &holder)
        .expect("remove linked wallet");

    assert_eq!(
        ctx.phygital_token_linked_wallet(phygital_token.phygital_token),
        Pubkey::default()
    );
    assert_eq!(
        ctx.phygital_token_lock_state(phygital_token.phygital_token),
        false
    );
}

#[test]
fn remove_linked_wallet_rejects_non_linked_wallet() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_set_linked_wallet(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    ctx.svm
        .airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_linked_wallet(&phygital_token, &attacker);
    assert_phygital_token_program_error(err, "LinkedWalletMismatch");
    assert_eq!(
        ctx.phygital_token_linked_wallet(phygital_token.phygital_token),
        holder.pubkey()
    );
}

#[test]
fn remove_linked_wallet_rejects_linked_wallet_not_matching_token_record() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let impostor = Keypair::new();

    ctx.send_set_linked_wallet(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    ctx.svm
        .airdrop(&impostor.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.remove_linked_wallet_ix(impostor.pubkey(), phygital_token.phygital_token);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&impostor]);
    assert_phygital_token_program_error(err, "LinkedWalletMismatch");
    assert_eq!(
        ctx.phygital_token_linked_wallet(phygital_token.phygital_token),
        holder.pubkey()
    );
}

#[test]
fn remove_linked_wallet_rejects_permanent_token() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let owner = Keypair::new();
    let phygital_token =
        ctx.init_phygital_token_with_linked_wallet(&passkey, PhygitalTokenType::Permanent, owner.pubkey());

    ctx.svm.airdrop(&owner.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let err = ctx.send_remove_linked_wallet(&phygital_token, &owner);
    assert_phygital_token_program_error(err, "PermanentLinkedWalletImmutable");
    assert_eq!(
        ctx.phygital_token_linked_wallet(phygital_token.phygital_token),
        owner.pubkey()
    );
}

#[test]
fn remove_linked_wallet_preserves_last_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();

    ctx.send_set_linked_wallet(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    let count_before = ctx.last_sign_count(phygital_token.phygital_token);

    ctx.send_remove_linked_wallet(&phygital_token, &holder)
        .expect("remove linked wallet");

    assert_eq!(
        ctx.last_sign_count(phygital_token.phygital_token),
        count_before
    );
}

#[test]
fn remove_linked_wallet_emits_expected_token_state() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();

    ctx.send_set_linked_wallet(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    ctx.send_remove_linked_wallet(&phygital_token, &holder)
        .expect("remove linked wallet");

    let instance = ctx.phygital_token_account(phygital_token.phygital_token);
    assert_eq!(instance.linked_wallet, Pubkey::default());
    assert_eq!(
        instance.public_key,
        Secp256r1Pubkey(passkey.compressed_pubkey)
    );
    assert_eq!(instance.is_locked, 0);
}
