mod common;

use anchor_lang::prelude::Pubkey;
use common::{
    assert_token_program_error, current_slot_entry, unique_identifier, TestContext, TestPasskey,
};
use phygital_token::{AssetType, InitializeArgs, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_happy_lifecycle_with_retransfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &first_recipient, true)
        .expect("claim");
    assert_eq!(ctx.last_transfer_slot(asset.asset), first_slot);
    assert_eq!(ctx.asset_owner(asset.asset), first_recipient.pubkey());

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer_at_slot(
        &asset,
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("re-transfer");

    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
    assert_eq!(ctx.asset_owner(asset.asset), second_recipient.pubkey());
}

#[test]
fn e2e_remove_ownership_then_reclaim() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);
    let first_holder = Keypair::new();
    let second_holder = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &first_holder, true)
        .expect("initial claim");
    assert_eq!(ctx.asset_owner(asset.asset), first_holder.pubkey());

    ctx.send_remove_ownership(&asset, &first_holder)
        .expect("holder relinquishes ownership");
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, _) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer(&asset, &second_holder, true)
        .expect("re-claim after remove ownership");
    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
    assert_eq!(ctx.asset_owner(asset.asset), second_holder.pubkey());
}

#[test]
fn e2e_remove_ownership_from_unowned_asset_is_rejected() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    // Nobody has claimed the asset, so owner is the default pubkey.
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());

    let fake_owner = Keypair::new();
    ctx.svm
        .airdrop(&fake_owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&asset, &fake_owner);
    assert_token_program_error(err, "OwnerMismatch");
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());
}

#[test]
fn e2e_locked_holder_can_forfeit_via_remove_ownership() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset_of_type(&passkey, AssetType::Lockable);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    ctx.set_current_slot(first_slot.saturating_add(1));

    let err = ctx.send_execute_transfer(&asset, &next_recipient, true);
    assert_token_program_error(err, "AssetIsCurrentlyLocked");

    ctx.send_remove_ownership(&asset, &holder)
        .expect("forfeit locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
    assert_eq!(ctx.asset_owner(asset.asset), Pubkey::default());

    ctx.set_current_slot(first_slot.saturating_add(2));
    ctx.send_execute_transfer(&asset, &next_recipient, true)
        .expect("new holder claims the forfeited asset");
    assert_eq!(ctx.asset_owner(asset.asset), next_recipient.pubkey());
}

#[test]
fn e2e_asset_pubkey_reinit_is_blocked() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.init_asset(&passkey);

    // Re-initializing the same passkey PDA must fail (account already exists).
    let args = InitializeArgs {
        identifier: unique_identifier(),
        secp256r1_pubkey: Secp256r1Pubkey(passkey.compressed_pubkey),
        asset_type: AssetType::Transferable,
    };
    let payer = ctx.payer.insecure_clone();
    let ix = ctx.initialize_ix(payer.pubkey(), asset.asset, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&payer])
        .expect_err("re-initializing an existing asset PDA should fail");
}
