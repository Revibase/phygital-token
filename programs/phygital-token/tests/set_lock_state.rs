mod common;

use common::{assert_token_program_error, current_slot_entry, TestContext, TestPasskey};
use phygital_token::AssetType;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn set_lock_state_owner_can_toggle_lock() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Configurable);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("initial claim transfer");

    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    let unlock_ix = ctx.set_lock_state_ix(holder.pubkey(), asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&holder]).expect("unlock asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
}

#[test]
fn set_lock_state_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Configurable);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("initial claim transfer");
    ctx.svm
        .airdrop(&attacker.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let ix = ctx.set_lock_state_ix(attacker.pubkey(), asset.asset, false);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&attacker]);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.asset_lock_state(asset.asset), true);
}

#[test]
fn set_lock_state_rejects_non_configurable_asset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();

    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("initial claim transfer");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);

    let ix = ctx.set_lock_state_ix(holder.pubkey(), asset.asset, true);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&holder]);
    assert_token_program_error(err, "AssetIsNotConfigurable");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
}

#[test]
fn locked_holder_cannot_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Configurable);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim locked asset from custody");

    ctx.set_current_slot(first_slot.saturating_add(1));

    let held = common::MintedAsset {
        passkey: passkey.clone(),
        recipient: holder.insecure_clone(),
        ..asset
    };
    let err = ctx
        .send_execute_transfer_from(&held, holder.pubkey(), &next_recipient, true, None, None)
        .expect_err("locked holder should not transfer");
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("AssetIsCurrentlyLocked") || err_str.contains("6018"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 1);
    assert_eq!(ctx.token_balance(next_recipient.pubkey(), asset.mint), 0);
}

#[test]
fn unlock_enables_holder_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Configurable);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim locked asset from custody");

    let unlock_ix = ctx.set_lock_state_ix(holder.pubkey(), asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&holder]).expect("unlock asset");

    ctx.set_current_slot(first_slot.saturating_add(1));

    let held = common::MintedAsset {
        passkey: passkey.clone(),
        recipient: holder.insecure_clone(),
        ..asset
    };
    ctx.send_execute_transfer_from(&held, holder.pubkey(), &next_recipient, true, None, None)
        .expect("unlocked holder can transfer");

    assert_eq!(ctx.token_balance(holder.pubkey(), asset.mint), 0);
    assert_eq!(ctx.token_balance(next_recipient.pubkey(), asset.mint), 1);
}