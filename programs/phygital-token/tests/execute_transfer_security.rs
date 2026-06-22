mod common;

use anchor_lang::solana_program::system_instruction;
use common::{
    assert_token_program_error, assert_transaction_failed, current_slot_entry, MintedAsset,
    TestContext, TestPasskey, LAMPORTS_PER_SOL,
};
use phygital_token::Secp256r1Pubkey;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn execute_transfer_rejects_wrong_signature() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let bad_sig = [0u8; 64];
    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction_with(
        ctx.program_authority(),
        slot_number,
        slot_hash,
        Some(bad_sig),
    );
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        asset.asset,
        asset.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_transaction_failed(err);
}

#[test]
fn execute_transfer_rejects_passkey_for_different_asset() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset_a = ctx.mint_asset_with_passkey(&passkey_a);
    ctx.mint_second_asset_same_design(&asset_a, &passkey_b);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let asset_b_instance = ctx.asset_pda(&Secp256r1Pubkey(passkey_b.compressed_pubkey));
    let (secp_ix, verify_args) = passkey_a.secp256r1_verify_instruction(
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        asset_b_instance,
        asset_a.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "Secp256r1PubkeyMismatch");
}

#[test]
fn execute_transfer_rejects_wrong_sender_in_message_hash() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let wrong_sender = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(
        wrong_sender.pubkey(),
        slot_number,
        slot_hash,
    );
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        asset.asset,
        asset.mint,
        verify_args,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "ClientDataHashMismatch");
}

#[test]
fn execute_transfer_rejects_secp_not_preceding() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    let transfer_ix = ctx.execute_transfer_ix(
        recipient.pubkey(),
        ctx.program_authority(),
        asset.asset,
        asset.mint,
        verify_args,
    );
    let noop = system_instruction::transfer(&recipient.pubkey(), &recipient.pubkey(), 0);
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err = ctx
        .send_execute_transfer_with_instructions(vec![secp_ix, noop, transfer_ix], &[&recipient]);
    assert_token_program_error(err, "InvalidSecp256r1Instruction");
}

#[test]
fn execute_transfer_rejects_slot_not_in_sysvar() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let missing_slot = 9_999_999;
    let missing_hash = [7u8; 32];

    let err = ctx.send_execute_transfer_from(
        &asset,
        ctx.program_authority(),
        &recipient,
        true,
        Some(missing_slot),
        Some(missing_hash),
    );
    assert_token_program_error(err, "InvalidSlotHash");
}

#[test]
fn execute_transfer_rejects_wrong_transfer_hook_program() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let (secp_ix, verify_args) = passkey.secp256r1_verify_instruction(
        ctx.program_authority(),
        slot_number,
        slot_hash,
    );
    let wrong_hook = Keypair::new().pubkey();
    let transfer_ix = ctx.execute_transfer_ix_with_hook(
        recipient.pubkey(),
        ctx.program_authority(),
        asset.asset,
        asset.mint,
        verify_args,
        wrong_hook,
    );
    ctx.svm
        .airdrop(&recipient.pubkey(), 2 * LAMPORTS_PER_SOL)
        .ok();
    let err =
        ctx.send_execute_transfer_with_instructions(vec![secp_ix, transfer_ix], &[&recipient]);
    let err_str = format!("{:?}", err.expect_err("wrong hook"));
    assert!(
        err_str.contains("InvalidTransferHookProgram")
            || err_str.contains("ConstraintAddress")
            || err_str.contains("6018")
            || err_str.contains("2012"),
        "unexpected error: {err_str}"
    );
}

#[test]
fn execute_transfer_fails_with_single_mint_and_no_rent_fund() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey);
    let recipient = Keypair::new();

    assert_eq!(ctx.program_authority_lamports(), 0);
    let err = ctx.send_execute_transfer(&asset, &recipient, true);
    assert_transaction_failed(err);
    assert_eq!(ctx.token_balance(ctx.program_authority(), asset.mint), 1);
}

#[test]
fn execute_transfer_succeeds_after_mint_funded_rent() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey_a);
    ctx.mint_second_asset_same_design(&asset, &TestPasskey::generate());
    let recipient = Keypair::new();

    assert!(ctx.program_authority_lamports() >= ctx.recipient_ata_rent());
    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("transfer after mint-funded rent top-ups");
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 1);
}

#[test]
fn execute_transfer_succeeds_after_manual_rent_fund() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_without_fund(&passkey);
    ctx.fund_program_authority(Some(ctx.recipient_ata_rent()));
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("transfer after manual fund");
    assert_eq!(ctx.token_balance(recipient.pubkey(), asset.mint), 1);
}

#[test]
fn execute_transfer_sets_recipient_close_authority_to_program_authority() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("transfer");

    assert_eq!(
        ctx.recipient_close_authority(recipient.pubkey(), asset.mint),
        Some(ctx.program_authority())
    );
}

#[test]
fn execute_transfer_recipient_chain_to_second_recipient() {
    let mut ctx = TestContext::new();
    let passkey = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let recipient = &asset.recipient;
    let second_recipient = Keypair::new();

    let (first_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, recipient, true)
        .expect("claim to recipient");

    let second_slot = first_slot.saturating_add(1);
    ctx.set_current_slot(second_slot);

    let asset_for_recipient = MintedAsset {
        passkey: passkey.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: asset.asset,
        group_mint: asset.group_mint,
    };
    ctx.send_execute_transfer_from(
        &asset_for_recipient,
        recipient.pubkey(),
        &second_recipient,
        true,
        None,
        None,
    )
    .expect("recipient re-transfer");

    assert_eq!(ctx.token_balance(second_recipient.pubkey(), asset.mint), 1);
    let (owner, _, _) = ctx.asset_fields(asset.asset);
    assert_eq!(owner, second_recipient.pubkey());
}

#[test]
fn execute_transfer_rejects_passkey_for_unclaimed_asset_b() {
    let mut ctx = TestContext::new();
    let passkey_a = TestPasskey::generate();
    let passkey_b = TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey_a);
    let asset_b_instance = ctx.mint_second_asset_same_design(&asset, &passkey_b);
    let recipient = Keypair::new();

    ctx.send_execute_transfer(&asset, &recipient, true)
        .expect("claim asset A");

    let asset_b = MintedAsset {
        passkey: passkey_b.clone(),
        design_owner: Keypair::new(),
        recipient: Keypair::new(),
        mint: asset.mint,
        asset: asset_b_instance,
        group_mint: asset.group_mint,
    };
    let err = ctx.send_execute_transfer_from(
        &asset_b,
        recipient.pubkey(),
        &Keypair::new(),
        true,
        None,
        None,
    );
    assert_token_program_error(err, "OwnerMismatch");
}
