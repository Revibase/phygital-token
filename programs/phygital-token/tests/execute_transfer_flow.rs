mod common;

use anchor_lang::AccountDeserialize;
use common::{current_slot_entry, MintedAsset, TestContext, TestPasskey, LAMPORTS_PER_SOL};
use phygital_token::state::Asset;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_moves_asset_to_recipient_without_sender_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let program_authority = ctx.program_authority();

    assert_eq!(ctx.token_balance(program_authority, asset.mint), 1);
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 0);

    let (transfer_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("execute_transfer should succeed with secp256r1 + recipient signature only");
    assert_eq!(
        ctx.last_transfer_slot(asset.asset),
        transfer_slot,
        "asset instance should record the slot used for the transfer"
    );

    assert_eq!(
        ctx.token_balance(program_authority, asset.mint),
        0,
        "custody balance should be zero after transfer"
    );
    assert!(
        !ctx.sender_ata_exists(program_authority, asset.mint),
        "custody ata should be closed when balance was 1"
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), asset.mint),
        1,
        "recipient should hold the asset token"
    );

    let asset_account = ctx
        .svm
        .get_account(&asset.asset)
        .expect("asset instance account");
    let instance = Asset::try_deserialize(&mut asset_account.data.as_ref())
        .expect("deserialize asset instance");
    assert_eq!(instance.owner, recipient.pubkey());
}

#[test]
fn execute_transfer_rejects_sender_not_matching_asset_owner() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey_a);
    ctx.mint_second_asset_same_design(&asset, &passkey_b);

    let recipient = Keypair::new();
    let asset_for_transfer = MintedAsset {
        passkey: passkey_a.clone(),
        ..asset
    };

    ctx.send_execute_transfer(&asset_for_transfer, &recipient, true)
        .expect("claim first asset");

    // program_authority still holds the second asset's token, but this instance's owner is `recipient`.
    let wrong_recipient = Keypair::new();
    let err = ctx
        .send_execute_transfer_from(
            &asset_for_transfer,
            ctx.program_authority(),
            &wrong_recipient,
            true,
            None,
            None,
        )
        .expect_err("transfer with sender not matching asset owner should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("OwnerMismatch") || err_str.contains("6012"),
        "unexpected error: {err:?}"
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), asset_for_transfer.mint),
        1
    );
    assert_eq!(
        ctx.token_balance(wrong_recipient.pubkey(), asset_for_transfer.mint),
        0
    );
}

#[test]
fn execute_transfer_keeps_sender_ata_when_balance_remains() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey_a);
    ctx.mint_second_asset_same_design(&asset, &passkey_b);

    let program_authority = ctx.program_authority();
    assert_eq!(ctx.token_balance(program_authority, asset.mint), 2);

    let recipient = Keypair::new();
    let asset_for_transfer = MintedAsset {
        passkey: passkey_a.clone(),
        ..asset
    };

    ctx.send_execute_transfer(&asset_for_transfer, &recipient, true)
        .expect("transfer with remaining balance should succeed");

    assert_eq!(
        ctx.token_balance(program_authority, asset_for_transfer.mint),
        1
    );
    assert!(
        ctx.sender_ata_exists(program_authority, asset_for_transfer.mint),
        "custody ata should stay open when balance remains"
    );
    assert_eq!(
        ctx.token_balance(recipient.pubkey(), asset_for_transfer.mint),
        1
    );
}

#[test]
fn execute_transfer_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();

    let err = ctx
        .send_execute_transfer(&asset, &recipient, false)
        .expect_err("execute_transfer without secp256r1 ix should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidSecp256r1Instruction")
            || err_str.contains("6002")
            || err_str.contains("PrivilegeEscalation")
            || err_str.contains("MissingSecp256r1Instruction")
            || err_str.contains("InvalidArgument")
            || err_str.contains("ClientDataHashMismatch"),
        "unexpected error: {err:?}"
    );
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
}

#[test]
fn direct_owner_transfer_checked_is_blocked_by_transfer_hook() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let claimant = &asset.recipient;

    ctx.send_execute_transfer(&asset, claimant, true)
        .expect("claim asset into recipient wallet");

    let recipient = Keypair::new();
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .unwrap();

    let create_ata_ix =
        ctx.create_recipient_ata_ix(recipient.pubkey(), recipient.pubkey(), asset.mint);
    TestContext::send_instruction(&mut ctx.svm, create_ata_ix, &[&recipient])
        .expect("create recipient ata");

    let transfer_ix =
        ctx.owner_transfer_checked_ix(claimant.pubkey(), asset.mint, recipient.pubkey());

    let err = TestContext::send_instruction(&mut ctx.svm, transfer_ix, &[claimant])
        .expect_err("owner-signed transfer_checked should not bypass execute_transfer");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidTransferAuthority")
            || err_str.contains("6012")
            || err_str.contains("MissingAccount")
            || err_str.contains("MissingRequiredSignature")
            || err_str.contains("custom program error"),
        "transfer hook should block owner-signed transfer_checked: {err:?}"
    );
    assert_eq!(ctx.token_balance(claimant.pubkey(), asset.mint), 1);
}

#[test]
fn execute_transfer_rejects_slot_not_greater_than_last_transfer() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    ctx.send_execute_transfer(&asset, &first_recipient, true)
        .expect("first transfer");

    assert_eq!(ctx.last_transfer_slot(asset.asset), slot_number);

    let err = ctx
        .send_execute_transfer_from(
            &asset,
            first_recipient.pubkey(),
            &second_recipient,
            true,
            Some(slot_number),
            Some(slot_hash),
        )
        .expect_err("reusing the same slot after a successful transfer should fail");

    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("StaleTransferSlot") || err_str.contains("6013"),
        "expected stale slot error, got: {err:?}"
    );
    assert_eq!(ctx.token_balance(second_recipient.pubkey(), asset.mint), 0);
    assert_eq!(ctx.token_balance(first_recipient.pubkey(), asset.mint), 1);
}

#[test]
fn execute_transfer_allows_next_transfer_with_higher_slot() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let first_recipient = Keypair::new();
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &first_recipient, true)
        .expect("first transfer");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);
    let (second_slot, second_hash) = current_slot_entry(&ctx.svm);
    assert!(second_slot > first_slot);

    ctx.send_execute_transfer_from(
        &asset,
        first_recipient.pubkey(),
        &second_recipient,
        true,
        Some(second_slot),
        Some(second_hash),
    )
    .expect("second transfer with a higher slot should succeed");

    assert_eq!(ctx.last_transfer_slot(asset.asset), second_slot);
    assert_eq!(ctx.token_balance(second_recipient.pubkey(), asset.mint), 1);
}

#[test]
fn execute_transfer_claims_multiple_assets_to_same_recipient_ata() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey_a);
    ctx.mint_second_asset_same_design(&asset, &passkey_b);

    let recipient = Keypair::new();
    let asset_a = MintedAsset {
        passkey: passkey_a.clone(),
        ..asset
    };
    let asset_b = MintedAsset {
        passkey: passkey_b.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: ctx.asset_pda(&phygital_token::Secp256r1Pubkey(passkey_b.compressed_pubkey)),
        group_mint: asset.group_mint,
    };

    ctx.send_execute_transfer(&asset_a, &recipient, true)
        .expect("claim first asset");
    assert_eq!(
        ctx.recipient_close_authority(recipient.pubkey(), asset.mint),
        Some(ctx.program_authority())
    );

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.set_current_slot(first_slot.saturating_add(1));

    ctx.send_execute_transfer(&asset_b, &recipient, true)
        .expect("claim second asset to same recipient ata");

    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 2);
    assert_eq!(
        ctx.recipient_close_authority(recipient.pubkey(), asset.mint),
        Some(ctx.program_authority())
    );
    assert!(ctx.sender_ata_exists(recipient.pubkey(), asset.mint));
}
