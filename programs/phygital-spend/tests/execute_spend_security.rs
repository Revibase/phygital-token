mod common;

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use common::{
    assert_spend_error, current_slot_entry, TestContext, Signer, SPEND_DELEGATE_AMOUNT,
};
use phygital_token::AssetType;
use solana_keypair::Keypair;

#[test]
fn execute_spend_rejects_zero_amount() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();

    let err = ctx.send_execute_spend(&fixture, &recipient, 0, true);
    assert_spend_error(err, "SpendAmountZero");
}

#[test]
fn execute_spend_rejects_without_delegate_approval() {
    let mut ctx = TestContext::new_for_spend();
    let passkey = common::TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey_and_lock(&passkey, AssetType::Lockable);
    let holder = Keypair::new();
    let (claim_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim locked asset");
    ctx.set_current_slot(claim_slot.saturating_add(1));

    let spend_mint = ctx.create_spend_mint();
    ctx.mint_spend_tokens(&spend_mint, holder.pubkey(), SPEND_DELEGATE_AMOUNT);

    let fixture = common::SpendFixture {
        asset: common::MintedAsset {
            passkey,
            recipient: holder.insecure_clone(),
            ..asset
        },
        holder,
        spend_mint,
        spend_amount: SPEND_DELEGATE_AMOUNT,
    };
    let recipient = Keypair::new();

    let err = ctx.send_execute_spend(&fixture, &recipient, 1, true);
    assert_spend_error(err, "SpendDelegateMismatch");
}

#[test]
fn execute_spend_rejects_amount_above_allowance() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();

    let err = ctx
        .send_execute_spend(&fixture, &recipient, SPEND_DELEGATE_AMOUNT + 1, true);
    assert_spend_error(err, "InsufficientSpendAllowance");
}

#[test]
fn execute_spend_rejects_unlocked_asset() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);

    let unlock_ix = ctx.set_lock_state_ix(fixture.holder.pubkey(), fixture.asset.asset, false);
    TestContext::send_instruction(&mut ctx.svm, unlock_ix, &[&fixture.holder])
        .expect("unlock asset");

    let recipient = Keypair::new();
    let err = ctx.send_execute_spend(&fixture, &recipient, 1, true);
    assert_spend_error(err, "AssetIsNotLocked");
}

#[test]
fn execute_spend_rejects_transferable_asset_type() {
    let mut ctx = TestContext::new_for_spend();
    let passkey = common::TestPasskey::generate();
    let asset = ctx.mint_asset_with_passkey(&passkey);
    let holder = Keypair::new();
    let (claim_slot, _) = current_slot_entry(&ctx.svm);
    ctx.send_execute_transfer(&asset, &holder, true)
        .expect("claim transferable asset");
    ctx.set_current_slot(claim_slot.saturating_add(1));

    let spend_mint = ctx.create_spend_mint();
    let owner_ata = ctx.mint_spend_tokens(&spend_mint, holder.pubkey(), SPEND_DELEGATE_AMOUNT);
    ctx.approve_spend_delegate(
        &holder,
        asset.asset,
        spend_mint.mint,
        owner_ata,
        SPEND_DELEGATE_AMOUNT,
    );

    let fixture = common::SpendFixture {
        asset: common::MintedAsset {
            passkey,
            recipient: holder.insecure_clone(),
            ..asset
        },
        holder,
        spend_mint,
        spend_amount: SPEND_DELEGATE_AMOUNT,
    };
    let recipient = Keypair::new();

    let err = ctx.send_execute_spend(&fixture, &recipient, 1, true);
    assert_spend_error(err, "AssetIsNotLocked");
}

#[test]
fn execute_spend_rejects_owner_as_recipient() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let message = ctx.spend_verify_message(&fixture.holder.pubkey(), &fixture.spend_mint.mint, 1);
    let (secp_ix, verify_args) = fixture.asset.passkey.verify_asset_secp256r1_instruction(
        message,
        slot_number,
        slot_hash,
    );

    let owner_ata = get_associated_token_address_with_program_id(
        &fixture.holder.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );

    let spend_ix = ctx.execute_spend_ix(
        fixture.asset.asset,
        fixture.holder.pubkey(),
        fixture.spend_mint.mint,
        owner_ata,
        fixture.holder.pubkey(),
        owner_ata,
        verify_args,
        1,
    );

    let payer = &ctx.payer;
    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, spend_ix], &[payer]);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidSpendRecipient")
            || err_str.contains("ConstraintDuplicateMutableAccount"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn execute_spend_rejects_wrong_owner_account() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();
    let attacker = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let message = ctx.spend_verify_message(&recipient.pubkey(), &fixture.spend_mint.mint, 1);
    let (secp_ix, verify_args) = fixture
        .asset
        .passkey
        .verify_asset_secp256r1_instruction(message, slot_number, slot_hash);

    let owner_ata = get_associated_token_address_with_program_id(
        &fixture.holder.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );
    ctx.svm.airdrop(&recipient.pubkey(), common::LAMPORTS_PER_SOL).ok();
    let payer = &ctx.payer;
    let create_ata_ix = ctx.create_recipient_ata_ix(
        payer.pubkey(),
        recipient.pubkey(),
        fixture.spend_mint.mint,
    );
    TestContext::send_instruction(&mut ctx.svm, create_ata_ix, &[payer])
        .expect("create recipient ata");
    let recipient_ata = get_associated_token_address_with_program_id(
        &recipient.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );

    let spend_ix = ctx.execute_spend_ix(
        fixture.asset.asset,
        attacker.pubkey(),
        fixture.spend_mint.mint,
        owner_ata,
        recipient.pubkey(),
        recipient_ata,
        verify_args,
        1,
    );

    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, spend_ix], &[payer]);
    assert_spend_error(err, "OwnerMismatch");
}

#[test]
fn execute_spend_requires_preceding_secp256r1_instruction() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();

    let err = ctx.send_execute_spend(&fixture, &recipient, 1, false);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("InvalidSecp256r1Instruction")
            || err_str.contains("MissingSecp256r1Instruction")
            || err_str.contains("InvalidArgument")
            || err_str.contains("ClientDataHashMismatch"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn execute_spend_rejects_mismatched_verify_message() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);

    let wrong_message = b"not-a-spend-authorization";
    let (secp_ix, verify_args) = fixture.asset.passkey.verify_asset_secp256r1_instruction(
        wrong_message,
        slot_number,
        slot_hash,
    );

    let owner_ata = get_associated_token_address_with_program_id(
        &fixture.holder.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );
    ctx.svm.airdrop(&recipient.pubkey(), common::LAMPORTS_PER_SOL).ok();
    let payer = &ctx.payer;
    let create_ata_ix = ctx.create_recipient_ata_ix(
        payer.pubkey(),
        recipient.pubkey(),
        fixture.spend_mint.mint,
    );
    TestContext::send_instruction(&mut ctx.svm, create_ata_ix, &[payer])
        .expect("create recipient ata");
    let recipient_ata = get_associated_token_address_with_program_id(
        &recipient.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );

    let spend_ix = ctx.execute_spend_ix(
        fixture.asset.asset,
        fixture.holder.pubkey(),
        fixture.spend_mint.mint,
        owner_ata,
        recipient.pubkey(),
        recipient_ata,
        verify_args,
        1,
    );

    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, spend_ix], &[payer]);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("ChallengeHashMismatch") || err_str.contains("6001"),
        "unexpected error: {err:?}"
    );
}

#[test]
fn execute_spend_rejects_wrong_passkey() {
    let mut ctx = TestContext::new_for_spend();
    let fixture = ctx.setup_spend_fixture(SPEND_DELEGATE_AMOUNT);
    let recipient = Keypair::new();
    let wrong_passkey = common::TestPasskey::generate();
    let (slot_number, slot_hash) = current_slot_entry(&ctx.svm);
    let message = ctx.spend_verify_message(&recipient.pubkey(), &fixture.spend_mint.mint, 1);
    let (secp_ix, verify_args) =
        wrong_passkey.verify_asset_secp256r1_instruction(message, slot_number, slot_hash);

    let owner_ata = get_associated_token_address_with_program_id(
        &fixture.holder.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );
    ctx.svm.airdrop(&recipient.pubkey(), common::LAMPORTS_PER_SOL).ok();
    let payer = &ctx.payer;
    let create_ata_ix = ctx.create_recipient_ata_ix(
        payer.pubkey(),
        recipient.pubkey(),
        fixture.spend_mint.mint,
    );
    TestContext::send_instruction(&mut ctx.svm, create_ata_ix, &[payer])
        .expect("create recipient ata");
    let recipient_ata = get_associated_token_address_with_program_id(
        &recipient.pubkey(),
        &fixture.spend_mint.mint,
        &TOKEN_2022_ID,
    );

    let spend_ix = ctx.execute_spend_ix(
        fixture.asset.asset,
        fixture.holder.pubkey(),
        fixture.spend_mint.mint,
        owner_ata,
        recipient.pubkey(),
        recipient_ata,
        verify_args,
        1,
    );

    let err = TestContext::send_instructions(&mut ctx.svm, &[secp_ix, spend_ix], &[payer]);
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("Secp256r1PubkeyMismatch") || err_str.contains("6003"),
        "unexpected error: {err:?}"
    );
}
