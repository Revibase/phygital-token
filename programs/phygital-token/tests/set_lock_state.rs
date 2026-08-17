mod common;

use common::{assert_token_program_error, current_slot_entry, TestContext, TestPasskey};
use phygital_token::AssetType;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn set_lock_state_owner_can_toggle_lock() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset_of_type(&passkey, AssetType::Lockable);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("initial claim transfer");

    // Claiming a Lockable asset auto-locks it.
    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    let unlock_ix = ctx.set_lock_state_ix(holder.pubkey(), asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&holder]).expect("unlock asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
}

#[test]
fn set_lock_state_rejects_non_owner() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset_of_type(&passkey, AssetType::Lockable);
    let holder = Keypair::new();
    let attacker = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
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
fn set_lock_state_rejects_non_lockable_asset() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let holder = Keypair::new();

    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("initial claim transfer");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);

    let ix = ctx.set_lock_state_ix(holder.pubkey(), asset.asset, true);
    let err = TestContext::send_instruction(&mut ctx.svm, ix, &[&holder]);
    assert_token_program_error(err, "AssetIsNotLockable");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
}

#[test]
fn locked_holder_cannot_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset_of_type(&passkey, AssetType::Lockable);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    ctx.set_current_slot(first_slot.saturating_add(1));

    let err = ctx
        .send_transfer_ownership(&asset, &next_recipient, true)
        .expect_err("locked holder should not transfer");
    assert!(
        format!("{err:?}").contains("AssetIsCurrentlyLocked"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.asset_owner(asset.asset), holder.pubkey());
}

#[test]
fn unlock_enables_holder_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset_of_type(&passkey, AssetType::Lockable);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_transfer_ownership(&asset, &holder, true)
        .expect("claim locked asset");

    let unlock_ix = ctx.set_lock_state_ix(holder.pubkey(), asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&holder]).expect("unlock asset");

    ctx.set_current_slot(first_slot.saturating_add(1));

    ctx.send_transfer_ownership(&asset, &next_recipient, true)
        .expect("unlocked holder can transfer");

    assert_eq!(ctx.asset_owner(asset.asset), next_recipient.pubkey());
}
