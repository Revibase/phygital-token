mod common;

use common::{
    assert_transaction_failed, current_slot_entry, MintedAsset, TestContext, TestPasskey,
};
use phygital_token::{AssetType, MintTokenArgs, Secp256r1Pubkey};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn e2e_happy_lifecycle_with_retransfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &first_recipient, true)
        .expect("claim");
    assert_eq!(ctx.last_transfer_slot(asset.asset), first_slot);

    let (owner, mint, _) = ctx.asset_fields(asset.asset);
    assert_eq!(owner, first_recipient.pubkey());
    assert_eq!(mint, asset.mint);

    let asset_for_recipient = MintedAsset {
        passkey: passkey.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: asset.asset,
        group_mint: asset.group_mint,
    };
    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer_from(
        &asset_for_recipient,
        first_recipient.pubkey(),
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("re-transfer");

    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
    assert_eq!(ctx.token_balance(second_recipient.pubkey(), asset.mint), 1);
}

#[test]
fn e2e_mint_funded_rent_liveness() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey_a);
    let recipient = Keypair::new();

    let err = ctx.send_execute_transfer(&asset, &recipient, true);
    assert_transaction_failed(err);

    ctx.mint_second_asset_same_design(&asset, &TestPasskey::generate());
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("transfer after one rent top-up mint");
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 1);
}

#[test]
fn e2e_manual_rent_fund_liveness() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey);
    ctx.fund_program_authority(Some(ctx.recipient_ata_rent()));
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("transfer with manual rent fund");
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 1);
}

#[test]
fn e2e_multi_asset_same_design_custody() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let passkey_c = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey_a);
    ctx.mint_second_asset_same_design(&asset, &passkey_b);
    ctx.mint_second_asset_same_design(&asset, &passkey_c);

    let recipient_a = Keypair::new();
    let recipient_b = Keypair::new();
    let asset_a = MintedAsset {
        passkey: passkey_a.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: asset.asset,
        group_mint: asset.group_mint,
    };
    let asset_b = MintedAsset {
        passkey: passkey_b.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: ctx.asset_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey)),
        group_mint: asset.group_mint,
    };

    ctx.send_execute_transfer(&asset_a, &recipient_a, true)
        .expect("claim A");
    ctx.send_execute_transfer(&asset_b, &recipient_b, true)
        .expect("claim B");

    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
    assert_eq!(ctx.token_balance(recipient_a.pubkey(), asset.mint), 1);
    assert_eq!(ctx.token_balance(recipient_b.pubkey(), asset.mint), 1);
}

#[test]
fn e2e_remove_ownership_then_reclaim() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let first_holder = Keypair::new();
    let second_holder = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &first_holder, true)
        .expect("initial claim");
    assert_eq!(ctx.last_transfer_slot(asset.asset), first_slot);
    assert_eq!(ctx.asset_fields(asset.asset).0, first_holder.pubkey());

    ctx.send_remove_ownership(&asset, &first_holder)
        .expect("holder relinquishes ownership");
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
    assert_eq!(ctx.token_balance(first_holder.pubkey(), asset.mint), 0);
    assert_eq!(ctx.asset_fields(asset.asset).0, ctx.program_authority());

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, _second_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer(&asset, &second_holder, true)
        .expect("re-claim after remove ownership");
    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
    assert_eq!(ctx.asset_fields(asset.asset).0, second_holder.pubkey());
    assert_eq!(ctx.token_balance(second_holder.pubkey(), asset.mint), 1);
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 0);
}

#[test]
fn e2e_remove_ownership_from_custody_is_impossible() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);

    assert_eq!(ctx.asset_fields(asset.asset).0, ctx.program_authority());
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);

    let fake_owner = Keypair::new();
    ctx.svm
        .airdrop(&fake_owner.pubkey(), common::LAMPORTS_PER_SOL)
        .unwrap();

    let err = ctx.send_remove_ownership(&asset, &fake_owner);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("OwnerMismatch")
            || err_str.contains("AccountNotInitialized")
            || err_str.contains("3012"),
        "unexpected error: {err_str}"
    );
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
}

#[test]
fn e2e_locked_holder_can_forfeit_via_remove_ownership() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Lockable);
    let holder = Keypair::new();
    let next_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), true);

    ctx.set_current_slot(first_slot.saturating_add(1));

    let held = MintedAsset {
        passkey: passkey.clone(),
        recipient: holder.insecure_clone(),
        design_owner: Keypair::new(),
        mint: asset.mint,
        asset: asset.asset,
        group_mint: asset.group_mint,
    };
    let err = ctx.send_execute_transfer_from(
        &held,
        holder.pubkey(),
        &next_recipient,
        true,
        None,
        None,
    );
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("AssetIsCurrentlyLocked")
            || err_str.contains("6018")
            || err_str.contains("StaleTransferSlot")
            || err_str.contains("6008"),
        "locked holder should not transfer: {err_str}"
    );

    ctx.send_remove_ownership(&held, &holder)
        .expect("forfeit locked asset");
    assert_eq!(ctx.asset_lock_state(asset.asset), false);
    assert_eq!(ctx.asset_fields(asset.asset).0, ctx.program_authority());
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);

    ctx.send_execute_transfer(&asset, &next_recipient, true)
        .expect("new holder claims from custody");
    assert_eq!(ctx.asset_fields(asset.asset).0, next_recipient.pubkey());
}

#[test]
fn e2e_asset_pda_squatting_blocks_victim() {
    let mut ctx = TestContext::new();
    let victim_passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&TestPasskey::generate());

    let victim_pubkey = Secp256r1Pubkey(victim_passkey.compressed_pubkey);
    let victim_asset = ctx.asset_pda(&victim_pubkey);
    let args = MintTokenArgs {
        secp256r1_pubkey: victim_pubkey,
        asset_type: AssetType::Transferable,
        credential_id: victim_passkey.credential_id,
    };
    let ix = ctx.mint_token_ix(ctx.payer.pubkey(), victim_asset, asset.mint, args);
    TestContext::send_instruction(&mut ctx.svm, ix, &[&ctx.payer]).expect("squatter mint");

    let ix2 = ctx.mint_token_ix(
        ctx.payer.pubkey(),
        victim_asset,
        asset.mint,
        MintTokenArgs {
            secp256r1_pubkey: victim_pubkey,
            asset_type: AssetType::Transferable,
            credential_id: victim_passkey.credential_id,
        },
    );
    TestContext::send_instruction(&mut ctx.svm, ix2, &[&ctx.payer]).expect_err("victim blocked");
}
