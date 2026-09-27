mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_phygital_token_program_error, TestContext, TestPasskey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn initialize_leaves_mint_unset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);

    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn assign_mint_minter_can_bind_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();

    ctx.send_assign_mint(phygital_token.phygital_token, mint)
        .expect("minter should be able to assign mint");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
}

#[test]
fn assign_mint_minter_can_overwrite_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_mint = Keypair::new().pubkey();
    let second_mint = Keypair::new().pubkey();

    ctx.send_assign_mint(phygital_token.phygital_token, first_mint)
        .expect("first assign_mint");
    ctx.send_assign_mint(phygital_token.phygital_token, second_mint)
        .expect("overwrite assign_mint");

    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        second_mint
    );
}

#[test]
fn assign_mint_rejects_non_minter() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();
    let stranger = ctx.payer.insecure_clone();

    let ix = ctx.assign_mint_ix(stranger.pubkey(), phygital_token.phygital_token, mint);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]);
    assert_phygital_token_program_error(err, "UnauthorizedAuthority");
    assert_eq!(
        ctx.phygital_token_mint(phygital_token.phygital_token),
        Pubkey::default()
    );
}

#[test]
fn assign_mint_does_not_change_linked_wallet_or_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let mint = Keypair::new().pubkey();

    ctx.send_set_linked_wallet(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    let linked_wallet_before = ctx.phygital_token_linked_wallet(phygital_token.phygital_token);
    let sign_count_before = ctx.last_sign_count(phygital_token.phygital_token);

    ctx.send_assign_mint(phygital_token.phygital_token, mint)
        .expect("assign mint after claim");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
    assert_eq!(
        ctx.phygital_token_linked_wallet(phygital_token.phygital_token),
        linked_wallet_before
    );
    assert_eq!(
        ctx.last_sign_count(phygital_token.phygital_token),
        sign_count_before
    );
    assert_eq!(linked_wallet_before, holder.pubkey());
}
