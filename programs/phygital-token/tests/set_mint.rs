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

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), Pubkey::default());
}

#[test]
fn set_mint_admin_can_bind_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();

    ctx.send_set_mint(phygital_token.phygital_token, mint)
        .expect("admin should be able to set mint");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
}

#[test]
fn set_mint_admin_can_overwrite_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let first_mint = Keypair::new().pubkey();
    let second_mint = Keypair::new().pubkey();

    ctx.send_set_mint(phygital_token.phygital_token, first_mint)
        .expect("first set_mint");
    ctx.send_set_mint(phygital_token.phygital_token, second_mint)
        .expect("overwrite set_mint");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), second_mint);
}

#[test]
fn set_mint_rejects_non_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let mint = Keypair::new().pubkey();
    let stranger = ctx.payer.insecure_clone();

    let ix = ctx.set_mint_ix(stranger.pubkey(), phygital_token.phygital_token, mint);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]);
    assert_phygital_token_program_error(err, "UnauthorizedAuthority");
    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), Pubkey::default());
}

#[test]
fn set_mint_does_not_change_owner_or_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let phygital_token = ctx.init_phygital_token(&passkey);
    let holder = Keypair::new();
    let mint = Keypair::new().pubkey();

    ctx.send_transfer_ownership(&phygital_token, &holder, true)
        .expect("claim phygital_token");
    let owner_before = ctx.phygital_token_owner(phygital_token.phygital_token);
    let sign_count_before = ctx.last_sign_count(phygital_token.phygital_token);

    ctx.send_set_mint(phygital_token.phygital_token, mint)
        .expect("set mint after claim");

    assert_eq!(ctx.phygital_token_mint(phygital_token.phygital_token), mint);
    assert_eq!(ctx.phygital_token_owner(phygital_token.phygital_token), owner_before);
    assert_eq!(ctx.last_sign_count(phygital_token.phygital_token), sign_count_before);
    assert_eq!(owner_before, holder.pubkey());
}
