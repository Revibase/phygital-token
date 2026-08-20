mod common;

use anchor_lang::prelude::Pubkey;
use common::{assert_token_program_error, TestContext, TestPasskey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn initialize_leaves_mint_unset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    assert_eq!(ctx.asset_mint(asset.asset), Pubkey::default());
}

#[test]
fn set_mint_admin_can_bind_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let mint = Keypair::new().pubkey();

    ctx.send_set_mint(asset.asset, mint)
        .expect("admin should be able to set mint");

    assert_eq!(ctx.asset_mint(asset.asset), mint);
}

#[test]
fn set_mint_admin_can_overwrite_mint() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let first_mint = Keypair::new().pubkey();
    let second_mint = Keypair::new().pubkey();

    ctx.send_set_mint(asset.asset, first_mint)
        .expect("first set_mint");
    ctx.send_set_mint(asset.asset, second_mint)
        .expect("overwrite set_mint");

    assert_eq!(ctx.asset_mint(asset.asset), second_mint);
}

#[test]
fn set_mint_rejects_non_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let mint = Keypair::new().pubkey();
    let stranger = ctx.payer.insecure_clone();

    let ix = ctx.set_mint_ix(stranger.pubkey(), asset.asset, mint);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&stranger]);
    assert_token_program_error(err, "UnauthorizedAuthority");
    assert_eq!(ctx.asset_mint(asset.asset), Pubkey::default());
}

#[test]
fn set_mint_does_not_change_owner_or_sign_count() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();
    let mint = Keypair::new().pubkey();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim token");
    let owner_before = ctx.asset_owner(asset.asset);
    let sign_count_before = ctx.last_sign_count(asset.asset);

    ctx.send_set_mint(asset.asset, mint)
        .expect("set mint after claim");

    assert_eq!(ctx.asset_mint(asset.asset), mint);
    assert_eq!(ctx.asset_owner(asset.asset), owner_before);
    assert_eq!(ctx.last_sign_count(asset.asset), sign_count_before);
    assert_eq!(owner_before, holder.pubkey());
}
